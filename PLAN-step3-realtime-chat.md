# Step 3: 实时对话引擎 - 后端技术方案

> 目标：在 immersive 场景播放时，学生可以随时向 AI 老师提问，AI 老师根据当前场景内容实时回答。
>
> 生成日期: 2026-04-16

---

## 1. 现有系统复用分析

### 1.1 可直接复用的核心组件

| 组件 | 文件路径 | 用途 | 复用方式 |
|------|----------|------|----------|
| `statelessGenerate()` | `lib/orchestration/stateless-generate.ts` | 无状态生成核心 | 直接调用，无需修改 |
| `DirectorGraph` | `lib/orchestration/director-graph.ts` | 多 Agent 编排 | 单 Agent 模式直接使用 |
| `buildStructuredPrompt()` | `lib/orchestration/prompt-builder.ts` | Prompt 构建 | 扩展 `buildStateContext()` 注入场景上下文 |
| `/api/chat` | `app/api/chat/route.ts` | 主聊天 API | 复用，可选新增 immersive 专用端点 |
| `StatelessChatRequest` | `lib/types/chat.ts` | 请求类型 | 扩展 `config` 字段 |
| `StatelessEvent` | `lib/types/chat.ts` | SSE 事件 | 完全复用 |
| `StreamBuffer` | `lib/buffer/stream-buffer.ts` | 展示节奏 | 前端复用，后端无需修改 |

### 1.2 复用策略

**策略 A：最小修改方案（推荐）**

复用现有 `/api/chat`，通过前端传递扩展的 `config` 字段：

```typescript
// 前端构造请求
const request: StatelessChatRequest = {
  messages: [userQuestion],
  storeState: { /* ... */ },
  config: {
    agentIds: [teacherAgentId],
    sessionType: 'qa',
    // 新增：immersive 场景上下文
    immersiveContext: {
      sceneId: currentSceneId,
      narrativeText: sceneContent.narrativeText,
      historicalContext: sceneContent.historicalContext,
      keyFormulas: sceneContent.keyFormulas,
      sceneImageUrl: sceneContent.sceneImageUrl,
    }
  },
  apiKey: '...',
  // ...
};
```

**优点**：
- 无需新增 API 端点
- 最小化后端改动
- 保持系统一致性

**缺点**：
- TypeScript 类型需要扩展

**策略 B：独立端点方案**

新增 `/api/immersive/chat`：

```typescript
POST /api/immersive/chat
{
  question: string,
  sceneId: string,
  sceneContent: {
    narrativeText: string,
    historicalContext?: string,
    keyFormulas?: string[],
    sceneImageUrl?: string,
  },
  teacherAgentId: string,
  // ... 其他字段
}
```

**优点**：
- 职责更清晰
- 独立演进，不影响现有系统

**缺点**：
- 代码重复
- 维护成本增加

**结论**：推荐策略 A，复用 `/api/chat`，通过扩展类型支持 immersive 上下文。

---

## 2. 需要新增的内容

### 2.1 类型扩展

**文件**: `lib/types/chat.ts`

```typescript
/**
 * Immersive 场景上下文
 * 用于在 immersive 场景中提问时，将当前场景内容传递给 AI 老师
 */
export interface ImmersiveContext {
  /** 当前场景 ID */
  sceneId: string;
  /** 场景叙述文本（底部旁白） */
  narrativeText: string;
  /** 历史背景标签（左上角） */
  historicalContext?: string;
  /** 关键公式列表 */
  keyFormulas?: string[];
  /** 场景背景图 URL */
  sceneImageUrl?: string;
  /** 场景标题 */
  sceneTitle?: string;
}

/**
 * 扩展 SessionConfig
 */
export interface SessionConfig {
  agentIds: string[];
  maxTurns: number;
  currentTurn: number;
  triggerAgentId?: string;
  defaultAgentId?: string;
  // 新增：immersive 场景上下文
  immersiveContext?: ImmersiveContext;
}
```

### 2.2 Prompt 扩展

**文件**: `lib/orchestration/prompt-builder.ts`

修改 `buildStructuredPrompt()` 函数，在 `# Current State` 部分添加 immersive 场景信息：

```typescript
// 在 buildStateContext() 函数中添加
function buildStateContext(
  storeState: StatelessChatRequest['storeState'],
  immersiveContext?: ImmersiveContext, // 新增参数
): string {
  const { stage, scenes, currentSceneId, mode, whiteboardOpen } = storeState;

  const lines: string[] = [];

  // ... 现有内容 ...

  // 新增：Immersive 场景上下文
  if (immersiveContext && currentSceneId === immersiveContext.sceneId) {
    lines.push(`\n## Current Immersive Scene`);
    lines.push(`Scene: ${immersiveContext.sceneTitle || 'Untitled'}`);
    if (immersiveContext.historicalContext) {
      lines.push(`Historical context: ${immersiveContext.historicalContext}`);
    }
    if (immersiveContext.narrativeText) {
      lines.push(`Narration: ${immersiveContext.narrativeText.slice(0, 200)}${immersiveContext.narrativeText.length > 200 ? '...' : ''}`);
    }
    if (immersiveContext.keyFormulas && immersiveContext.keyFormulas.length > 0) {
      lines.push(`Key formulas shown: ${immersiveContext.keyFormulas.join(', ')}`);
    }
    if (immersiveContext.sceneImageUrl) {
      lines.push(`Scene has a background image - students are viewing this visual content.`);
    }
    lines.push(`\nIMPORTANT: The student is asking about THIS specific scene. Reference the narration, historical context, and formulas above in your answer.`);
  }

  return lines.join('\n');
}
```

### 2.3 DirectorGraph 适配

**文件**: `lib/orchestration/director-graph.ts`

确保 Director 在单 Agent 模式下正确处理 immersive 场景：

```typescript
// buildInitialState() 函数中提取 immersiveContext
const immersiveContext = request.config.immersiveContext;
```

---

## 3. API 设计

### 3.1 方案选择：复用 `/api/chat`

**理由**：
1. 现有 `/api/chat` 已经是无状态设计，完全支持自定义上下文
2. SSE 流机制已经完善
3. DirectorGraph 支持单 Agent 快速响应

**前端调用示例**：

```typescript
// 构造请求
const request: StatelessChatRequest = {
  messages: [
    { role: 'user', content: userQuestion }
  ],
  storeState: {
    stage: currentStage,
    scenes: scenes,
    currentSceneId: currentScene.id,
    mode: 'playback',
    whiteboardOpen: false,
  },
  config: {
    agentIds: [selectedTeacherAgentId],
    sessionType: 'qa',
    immersiveContext: {
      sceneId: currentScene.id,
      sceneTitle: currentScene.title,
      narrativeText: sceneContent.narrativeText,
      historicalContext: sceneContent.historicalContext,
      keyFormulas: sceneContent.keyFormulas,
      sceneImageUrl: sceneContent.sceneImageUrl,
    },
  },
  apiKey: userApiKey,
  model: selectedModel,
};

// 发送请求
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
});

// 处理 SSE 流
const reader = response.body!.getReader();
// ... 使用 processSSEStream 解析
```

### 3.2 响应格式

完全复用现有的 `StatelessEvent` 流：

```
event: agent_start
data: {"type":"agent_start","data":{"messageId":"...","agentId":"default-physics-1","agentName":"Geeky Alex"}}

event: text_delta
data: {"type":"text_delta","data":{"content":"Great question! "}}

event: text_delta
data: {"type":"text_delta","data":{"content":"Looking at the formula on screen..."}}

event: done
data: {"type":"done","data":{"totalActions":0,"totalAgents":1,...}}
```

---

## 4. 场景感知对话的 Prompt 设计

### 4.1 Prompt 结构

基于 `buildStructuredPrompt()` 的现有结构，immersive 上下文将被注入到 `# Current State` 部分：

```
# Role
You are Geeky Alex.

## Your Personality
你是 Alex，一个20多岁的物理学PhD在读生...

## Your Classroom Role
Your role in this classroom: LEAD TEACHER...

# Output Format
...

# Current State
Mode: playback
Whiteboard: closed (slide canvas is visible)
Course: AP Physics - Work and Energy
Total scenes: 12
Current scene: "Work-Energy Theorem" (immersive, id: scene_123)

## Current Immersive Scene
Scene: Work-Energy Theorem
Historical context: 1840s - Joule's Experiments
Narration: The work-energy theorem connects the work done on an object to its change in kinetic energy...
Key formulas shown: W = ΔK = ½mv² - ½mv₀²
Scene has a background image - students are viewing this visual content.

IMPORTANT: The student is asking about THIS specific scene. Reference the narration, historical context, and formulas above in your answer.
```

### 4.2 场景感知 Prompt 设计原则

1. **相关性优先**：AI 老师的回答必须与当前场景内容直接相关
2. **上下文引用**：鼓励 AI 引用场景中的具体元素（公式、历史背景、叙述内容）
3. **视觉意识**：当有背景图时，提醒 AI 学生正在观看视觉内容
4. **避免重复**：如果场景叙述已经解释过的内容，AI 应该快速确认并延伸，而不是重复解释

### 4.3 具体指令示例

在 `buildStructuredPrompt()` 的 `## Your Classroom Role` 部分添加：

```typescript
const IMMERSIVE_GUIDELINES = `
## Immersive Scene Guidelines (CRITICAL)
When responding in an immersive scene context:
1. Reference specific elements from the scene: the narration text, historical context, or formulas shown.
2. If the student asks about something already explained in the narration, briefly confirm and extend with a new angle.
3. When the scene has a background image, acknowledge that students are viewing visual content.
4. Keep answers focused on the current scene topic — don't drift to unrelated concepts.
5. Use the formulas shown in the scene as concrete references in your explanations.
`;
```

---

## 5. NPC 同学的后端支持

### 5.1 触发机制设计

NPC 同学发言通过现有的 `discussion` 模式触发：

**前端调用方式**：

```typescript
// 启动多 Agent 讨论
const request: StatelessChatRequest = {
  messages: [],
  storeState: { /* ... */ },
  config: {
    agentIds: [teacherAgentId, npcAgentId1, npcAgentId2],
    sessionType: 'discussion',
    discussionTopic: '让同学谈谈对这个概念的理解',
    triggerAgentId: npcAgentId1, // 第一个发言的 NPC
    immersiveContext: { /* ... */ }, // 同样注入场景上下文
  },
  // ...
};
```

### 5.2 NPC 角色配置

NPC 同学直接使用现有的 Agent 注册系统：

**文件**: `lib/orchestration/registry/store.ts`

```typescript
// 预设学生 Agent
'default-3': {
  id: 'default-3',
  name: '显眼包',
  role: 'student',
  persona: '你是班上的显眼包，活泼幽默，喜欢开玩笑...',
  // ...
},
'default-4': {
  id: 'default-4',
  name: '好奇宝宝',
  role: 'student',
  persona: '你是好奇心强的学生，经常问为什么...',
  // ...
},
// ...
```

### 5.3 NPC 发言的 Prompt 扩展

在 `buildStructuredPrompt()` 的 `## Your Classroom Role` 中，学生角色已有明确指导：

```typescript
student: `Your role in this classroom: STUDENT.
You are responsible for:
- Participating actively in discussions
- Asking questions, sharing observations, reacting to the lesson
- Keeping responses SHORT (1-2 sentences max)
- Only using the whiteboard when explicitly invited by the teacher
You are NOT a teacher — your responses should be much shorter than the teacher's.`,
```

对于 immersive 场景中的 NPC，添加额外指导：

```typescript
const IMMERSIVE_NPC_GUIDELINES = `
## Immersive Scene Participation (Student Agents)
When participating in a discussion during an immersive scene:
1. React to the scene content: the narration, formulas, or historical context.
2. Ask questions that students might naturally ask when seeing this scene.
3. Share quick observations or connections you notice.
4. Your responses should feel like a natural student reaction, not a prepared speech.
5. Keep it brief — one question, one observation, or one reaction per turn.
`;
```

### 5.4 多 Agent 讨论流程

```
用户触发 "听同学怎么说"
    ↓
前端构造 discussion 请求
    ↓
/api/chat 接收请求
    ↓
DirectorGraph 决定发言顺序
    ↓
第一个 NPC (triggerAgentId) 发言
    ↓
Director 决定下一个发言者 (可能是老师、其他 NPC、或 END)
    ↓
SSE 流逐个返回每个 Agent 的发言
    ↓
前端接收并展示 NPC 气泡
```

### 5.5 NPC 发言的 SSE 事件

```
event: agent_start
data: {"type":"agent_start","data":{"agentId":"default-3","agentName":"显眼包"}}

event: text_delta
data: {"type":"text_delta","data":{"content":"哇，这个公式有点意思..."}}

event: agent_end
data: {"type":"agent_end","data":{"agentId":"default-3"}}

event: thinking
data: {"type":"thinking","data":{"stage":"director"}}

event: agent_start
data: {"type":"agent_start","data":{"agentId":"default-physics-1","agentName":"Geeky Alex"}}

// 老师回应...
```

---

## 6. 实现步骤拆分

### Phase 1: 类型扩展和 Prompt 基础（1-2 天）

**任务 1.1**：扩展 TypeScript 类型
- [ ] 在 `lib/types/chat.ts` 中添加 `ImmersiveContext` 接口
- [ ] 扩展 `SessionConfig` 添加 `immersiveContext?` 字段
- [ ] 更新 `StatelessChatRequest` 的类型定义

**任务 1.2**：扩展 Prompt 构建
- [ ] 修改 `buildStateContext()` 函数添加 `immersiveContext` 参数
- [ ] 在 `# Current State` 部分添加 immersive 场景信息
- [ ] 添加场景感知的指令文本

**验收标准**：
- 类型检查通过
- 单元测试覆盖新的 Prompt 生成逻辑

---

### Phase 2: 后端集成（1-2 天）

**任务 2.1**：修改 DirectorGraph
- [ ] 在 `buildInitialState()` 中提取 `immersiveContext`
- [ ] 将 `immersiveContext` 传递给 `buildStructuredPrompt()`
- [ ] 确保单 Agent 模式正确处理场景上下文

**任务 2.2**：API 验证
- [ ] 测试 `/api/chat` 接收 `config.immersiveContext`
- [ ] 验证 SSE 流正确返回
- [ ] 确保 Director 在有场景上下文时的决策正确

**验收标准**：
- API 端点正常响应
- SSE 流包含正确的 agent_start 和 text_delta 事件
- 日志记录显示场景上下文正确传递

---

### Phase 3: 前端集成（2-3 天）

**任务 3.1**：创建 `ImmersiveChatOverlay` 组件
- [ ] 实现 `components/immersive/immersive-chat-overlay.tsx`
- [ ] 集成 `useChatSessions` hook
- [ ] 实现 collapsed/expanded 状态切换
- [ ] 添加消息气泡展示

**任务 3.2**：集成场景上下文传递
- [ ] 从 `ImmersiveRenderer` 获取当前场景内容
- [ ] 构造 `ImmersiveContext` 对象
- [ ] 在发送请求时注入 `config.immersiveContext`

**任务 3.3**：实现用户提问流程
- [ ] 输入框和发送按钮
- [ ] 调用 `/api/chat` 的逻辑
- [ ] SSE 流解析和状态更新
- [ ] 错误处理和重试

**验收标准**：
- 用户可以在 immersive 场景中输入问题
- AI 老师的回答根据场景内容生成
- UI 交互流畅，无卡顿

---

### Phase 4: NPC 同学支持（2-3 天）

**任务 4.1**：创建 `ImmersiveNpcStrip` 组件
- [ ] 实现 `components/immersive/immersive-npc-strip.tsx`
- [ ] 显示 NPC 头像列表
- [ ] 实现发言气泡效果
- [ ] 思考状态指示器

**任务 4.2**：NPC 发言触发
- [ ] 添加 "听同学怎么说" 按钮
- [ ] 构造 discussion 请求
- [ ] 设置 `triggerAgentId` 为第一个发言的 NPC

**任务 4.3**：多 Agent 讨论展示
- [ ] 接收 SSE 流中的 agent_start/agent_end 事件
- [ ] 根据 `agentId` 更新对应的 NPC 状态
- [ ] 展示当前发言 NPC 的气泡

**验收标准**：
- NPC 头像正确显示
- NPC 发言气泡正确弹出
- 多 Agent 讨论流畅进行

---

### Phase 5: 优化和测试（1-2 天）

**任务 5.1**：性能优化
- [ ] 优化 Prompt 长度，避免 token 浪费
- [ ] 实现场景上下文缓存
- [ ] 优化 SSE 流的解析效率

**任务 5.2**：用户体验优化
- [ ] 添加打字机效果配置
- [ ] 优化移动端布局
- [ ] 添加动画和过渡效果

**任务 5.3**：端到端测试
- [ ] 测试各种场景类型（有/无公式、有/无历史背景等）
- [ ] 测试边缘情况（网络中断、超时等）
- [ ] 收集用户反馈并迭代

**验收标准**：
- 所有测试用例通过
- 用户反馈良好
- 性能指标达标（响应时间 < 3s）

---

## 7. 技术风险和应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| Prompt 长度超限 | 部分场景内容可能被截断 | 实现智能摘要，只传递关键信息 |
| NPC 发言质量不稳定 | 可能出现与场景无关的发言 | 在 Prompt 中强化场景相关性约束 |
| SSE 连接中断 | 对话可能中断 | 实现自动重连机制 |
| 移动端性能问题 | 复杂动画可能导致卡顿 | 降级处理，简化动画 |

---

## 8. 后续扩展点

1. **场景内容自适应总结**：根据对话历史，自动总结场景重点
2. **多轮上下文记忆**：跨场景保持对话上下文
3. **个性化 NPC**：根据学生偏好动态调整 NPC 人设
4. **语音输入/输出**：集成 TTS 和 STT 实现语音交互
5. **实时协作**：多个学生同时提问时的优先级处理

---

## 9. 总结

Step 3 的核心策略是**最小化后端改动，最大化前端复用**：

1. **复用**：`statelessGenerate`、`DirectorGraph`、`/api/chat`、`StreamBuffer`
2. **扩展**：类型定义、Prompt 构建、场景上下文注入
3. **新增**：前端 `ImmersiveChatOverlay` 和 `ImmersiveNpcStrip` 组件

通过这种方式，我们可以在不破坏现有架构的前提下，快速实现 immersive 场景的实时对话功能。
