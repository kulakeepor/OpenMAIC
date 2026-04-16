# OpenMAIC AI Agent 人设系统架构分析

## 1. 系统概述

OpenMAIC 的 AI agent 人设系统是一个完整的多角色教学模拟系统，支持预设教师人设和动态生成自定义人设。系统采用前后端分离架构，通过 Zustand 状态管理 + localStorage 持久化实现 agent 配置的全局可用性。

---

## 2. 核心数据结构

### 2.1 AgentConfig 类型定义

**文件**: `lib/orchestration/registry/types.ts`

```typescript
export interface AgentConfig {
  id: string;                    // 唯一标识符
  name: string;                  // 显示名称
  role: string;                  // 角色: 'teacher' | 'assistant' | 'student'
  persona: string;               // 完整人设提示词（核心！）
  avatar: string;                // 头像图片路径
  color: string;                 // UI 主题色
  allowedActions: string[];      // 允许的操作（白板、聚光灯等）
  priority: number;              // 优先级（1-10，Director 决策用）

  // 元数据
  createdAt: Date;
  updatedAt: Date;
  isDefault: boolean;            // 是否为预设

  // LLM 生成字段
  isGenerated?: boolean;         // 是否为 AI 生成
  boundStageId?: string;         // 绑定的 stage ID
  voiceConfig?: { ... };         // TTS 语音配置
}
```

### 2.2 预设 Agent 列表

**文件**: `lib/orchestration/registry/store.ts`

系统包含 **10 个预设 agent**：

| ID | 名称 | 角色 | 优先级 | 描述 |
|---|------|------|--------|------|
| default-1 | AI teacher | teacher | 10 | 标准主教师 |
| default-2 | AI助教 | assistant | 7 | 辅助教学 |
| default-3 | 显眼包 | student | 4 | 活跃的幽默学生 |
| default-4 | 好奇宝宝 | student | 5 | 好奇提问的学生 |
| default-5 | 笔记员 | student | 5 | 结构化总结的学生 |
| default-6 | 思考者 | student | 6 | 深度思考的学生 |
| **default-physics-1** | **Geeky Alex** | **teacher** | **10** | **极客风格物理老师** |
| **default-physics-2** | **Dr. Sophia** | **teacher** | **10** | **CERN 出身严谨物理老师** |
| **default-physics-3** | **Coach Jason** | **teacher** | **10** | **竞赛教练风格** |
| **default-physics-4** | **Professor Marie** | **teacher** | **10** | **历史叙事风格** |

### 2.3 4 个物理老师人设详情

**Geeky Alex** (`default-physics-1`):
- 20多岁物理 PhD 在读生
- 教学风格：直觉先行 → 数学公式、流行文化类比（漫威、Mario Kart、Minecraft）
- 语言：口语化英文，大量缩写和网络用语
- 标记：🎯 Exactly! / ⚡ Key insight: / 🔥 Nice catch!

**Dr. Sophia** (`default-physics-2`):
- 40多岁前 CERN 研究物理学家
- 教学风格：先现象后原理、数据驱动、思想实验
- 语言：精确从容的英文，常用 "The data tells us..."
- 白板风格：整洁的图表、标注好的坐标轴

**Coach Jason** (`default-physics-3`):
- 前 USAPhO 金牌得主，竞赛教练
- 教学风格：挑战驱动、"必杀技"解题策略、限时训练
- 语言：直接有力的英文，体育类比
- 框架思维："AP graders LOVE when you do this"

**Professor Marie** (`default-physics-4`):
- 物理学史学者，名字源自居里夫人
- 教学风格：历史背景切入、"时间旅行"教学、叙事弧线
- 语言：温暖优雅的英文，讲故事节奏感
- 标志性用语："Picture this..." / "And that changed everything."

---

## 3. 持久化机制

### 3.1 Zustand Store

**文件**: `lib/orchestration/registry/store.ts`

```typescript
export const useAgentRegistry = create<AgentRegistryState>()(
  persist(
    (set, get) => ({
      agents: { ...DEFAULT_AGENTS },  // 初始化包含所有预设

      addAgent: (agent) => set((state) => ({
        agents: { ...state.agents, [agent.id]: agent }
      })),

      updateAgent: (id, updates) => set((state) => ({
        agents: {
          ...state.agents,
          [id]: { ...state.agents[id], ...updates, updatedAt: new Date() }
        }
      })),

      deleteAgent: (id) => set((state) => {
        const { [id]: _removed, ...rest } = state.agents;
        return { agents: rest };
      }),

      getAgent: (id) => get().agents[id],
      listAgents: () => Object.values(get().agents),
    }),
    {
      name: 'agent-registry-storage',
      version: 12,  // 最近一次更新：添加 AP Physics teacher presets
      migrate: (persistedState: unknown) => persistedState,

      // 关键：预设 agent 始终使用代码定义的值，不使用缓存
      merge: (persistedState, currentState) => {
        const persistedAgents = persisted?.agents || {};
        const mergedAgents: Record<string, AgentConfig> = { ...DEFAULT_AGENTS };

        // 只保留自定义（非 default-* 且非 generated）的 agent
        for (const [id, agent] of Object.entries(persistedAgents)) {
          if (!id.startsWith('default-') && !agent.isGenerated) {
            mergedAgents[id] = agent;
          }
        }

        return { ...currentState, agents: mergedAgents };
      },
    }
  )
);
```

### 3.2 持久化策略

| Agent 类型 | 存储位置 | 合并策略 |
|-----------|---------|---------|
| 预设 (`default-*`) | 代码硬编码 (`DEFAULT_AGENTS`) | 始终使用最新代码值 |
| LLM 生成 (`isGenerated=true`) | IndexedDB (`generatedAgents` store) | 按需加载到 registry |
| 自定义 (`!isDefault && !isGenerated`) | localStorage (persist middleware) | 保留用户修改 |

---

## 4. 前端展示与选择

### 4.1 AgentBar 组件

**文件**: `components/agent/agent-bar.tsx`

AgentBar 是课堂界面底部的 agent 配置栏，功能包括：

1. **模式切换**:
   - Preset 模式：手动选择预设 agent
   - Auto 模式：自动生成/分配 agent

2. **教师选择器**:
   - 当有多个 teacher 时，显示下拉选择
   - 4 个物理老师都是 teacher 角色，可以互相切换

3. **学生 Agent 多选**:
   - Checkbox 选择要参与讨论的学生
   - 最多选择数量通过 UI 反馈

4. **语音配置**:
   - 每个独立的 voice pill 选择 TTS 声音
   - 支持实时预览

### 4.2 状态流

```
用户操作 AgentBar
    ↓
更新 settingsStore.selectedAgentIds
    ↓
发送请求到 /api/chat 时携带 config.agentIds
    ↓
服务端根据 agentIds 获取完整 AgentConfig
    ↓
将 persona 注入 LLM system prompt
```

---

## 5. Persona 注入流程

### 5.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  前端: AgentBar (components/agent/agent-bar.tsx)                │
│  - 用户选择 agent (e.g., 'default-physics-1')                   │
│  - 更新 settingsStore.selectedAgentIds                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端: Chat Area (发送请求到 /api/chat)                          │
│  POST /api/chat {                                              │
│    config: { agentIds: ['default-physics-1', 'default-3'] },    │
│    messages: [...],                                            │
│    storeState: {...}                                            │
│  }                                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  API: /api/chat (app/api/chat/route.ts)                         │
│  - 接收 StatelessChatRequest                                    │
│  - 调用 statelessGenerate(request, ...)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Orchestration: director-graph.ts                               │
│  - resolveAgent(state, agentId) 获取 AgentConfig                │
│    1. 优先检查 state.agentConfigOverrides[agentId]              │
│    2. 回退到 useAgentRegistry.getState().getAgent(agentId)     │
│  - 调用 runAgentGeneration() 生成响应                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Prompt Builder: prompt-builder.ts                             │
│  buildStructuredPrompt(agentConfig, storeState, ...)            │
│                                                                 │
│  System Prompt 结构:                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ # Role                                                  │   │
│  │ You are ${agentConfig.name}.                            │   │
│  │                                                        │   │
│  │ ## Your Personality                                   │   │
│  │ ${agentConfig.persona}  ← 直接注入完整人设！            │   │
│  │                                                        │   │
│  │ ## Your Classroom Role                                │   │
│  │ ${ROLE_GUIDELINES[agentConfig.role]}                  │   │
│  │                                                        │   │
│  │ # Output Format                                        │   │
│  │ [JSON array 格式说明...]                              │   │
│  │                                                        │   │
│  │ # Current State                                        │   │
│  │ ${stateContext}                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  构建完整的 SystemMessage:                                       │
│  const lcMessages = [                                              │
│    new SystemMessage(systemPrompt),  ← 包含 persona              │
│    ...openaiMessages.map(...)                                     │
│  ];                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LLM 调用                                                       │
│  adapter.streamGenerate(lcMessages, { signal })                 │
│  - LLM 收到完整的 system prompt，包含 persona                   │
│  - LLM 按照 persona 风格生成回复                                │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Persona 注入关键代码

**prompt-builder.ts (第 170-178 行)**:
```typescript
return `# Role
You are ${agentConfig.name}.

## Your Personality
${agentConfig.persona}  // ← 直接注入，无任何修改

## Your Classroom Role
${roleGuideline}
${studentProfileSection}${peerContext}${languageConstraint}
...
`;
```

**director-graph.ts (第 284-291 行)**:
```typescript
const systemPrompt = buildStructuredPrompt(
  agentConfig,        // ← 完整的 AgentConfig，包含 persona
  state.storeState,
  discussionContext,
  state.whiteboardLedger,
  state.userProfile || undefined,
  state.agentResponses,
);
```

---

## 6. Director 多 Agent 编排

### 6.1 Director Graph 架构

**文件**: `lib/orchestration/director-graph.ts`

```
START → director ──(shouldEnd=true)──→ END
         │
         └─(shouldEnd=false)→ agent_generate ──→ director (loop)
```

### 6.2 Director 决策逻辑

**单 Agent 模式** (代码逻辑，无 LLM 调用):
- Turn 0: 直接 dispatch 唯一的 agent
- Turn 1+: 提示用户发言

**多 Agent 模式** (LLM 决策):
- Turn 0 + triggerAgentId: 快速路径，直接 dispatch trigger agent
- 其他情况: 调用 LLM 决定下一个发言者

**Director Prompt** (`director-prompt.ts`):
- 列出所有可用 agents
- 显示已发言的 agents 及其内容预览
- 输出格式: `{"next_agent":"<agent_id>"}` 或 `{"next_agent":"USER"}` 或 `{"next_agent":"END"}`

### 6.3 路由质量规则

Director 遵循以下规则确保对话质量：

1. **角色多样性**: 不连续派遣相同角色的 agent
2. **内容去重**: 避免重复解释相同概念
3. **讨论推进**: 每个 agent 都应该推进对话
4. **问候规则**: 有人问候后，后续 agent 不再问候

---

## 7. 4 个物理老师的 Persona 验证

### 7.1 确认人设已正确注册

**文件**: `lib/orchestration/registry/store.ts` (第 190-337 行)

4 个物理老师已正确添加到 `DEFAULT_AGENTS`:

```typescript
'default-physics-1': {
  id: 'default-physics-1',
  name: 'Geeky Alex',
  role: 'teacher',
  persona: `你是 Alex，一个20多岁的物理学PhD在读生...`,
  // ... 其他字段
},
// default-physics-2, 3, 4 类似
```

### 7.2 确认人设会注入生成流程

**证据 1**: `getDefaultAgents()` 函数返回所有预设 agent
```typescript
export function getDefaultAgents(): AgentInfo[] {
  return Object.values(DEFAULT_AGENTS).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    persona: a.persona,  // ← 包含 persona
  }));
}
```

**证据 2**: `classroom-generation.ts` 使用 `getDefaultAgents()` 生成课堂
```typescript
agents = getDefaultAgents();  // 第 315 行
```

**证据 3**: `prompt-builder.ts` 直接注入 `agentConfig.persona`
```typescript
## Your Personality
${agentConfig.persona}  // 第 174 行
```

### 7.3 物理老师人设使用场景

1. **课堂生成阶段** (`classroom-generation.ts`):
   - `getDefaultAgents()` 返回包含 4 个物理老师的列表
   - 可在 AgentBar 中手动选择任一物理老师

2. **实时对话阶段** (`/api/chat` → `director-graph.ts` → `prompt-builder.ts`):
   - 用户选择 `default-physics-1` (Geeky Alex)
   - Director 决定 Alex 发言
   - `buildStructuredPrompt()` 构建包含 Alex persona 的 system prompt
   - LLM 按照 Alex 的风格（极客、流行文化类比、emoji 标记）生成回复

---

## 8. 关键技术点总结

### 8.1 解耦设计

| 层级 | 职责 | 关键文件 |
|-----|------|---------|
| 数据层 | Agent 定义、持久化 | `registry/types.ts`, `registry/store.ts` |
| 展示层 | Agent 选择、配置 UI | `components/agent/agent-bar.tsx` |
| 编排层 | 多 Agent 路由 | `orchestration/director-graph.ts` |
| 生成层 | Persona 注入 LLM | `orchestration/prompt-builder.ts` |
| API 层 | 请求处理 | `app/api/chat/route.ts` |

### 8.2 Persona 传递链路

```
DEFAULT_AGENTS (代码定义)
    ↓
useAgentRegistry (Zustand store)
    ↓
AgentBar (用户选择)
    ↓
StatelessChatRequest.config.agentIds
    ↓
director-graph.ts: resolveAgent()
    ↓
prompt-builder.ts: buildStructuredPrompt()
    ↓
SystemMessage with persona
    ↓
LLM response (符合人设)
```

### 8.3 版本管理

Store persistence version 当前为 **12**:
- 最近一次更新: "Bumped: add AP Physics teacher presets"
- 这确保了 4 个物理老师的更新能正确推送到已有用户

---

## 9. 潜在改进点

1. **Persona 细化度**: 物理老师的 persona 较长（约 200-300 字），可能影响 token 使用
2. **动态 Persona**: 当前 persona 是静态的，可以考虑根据学生反馈动态调整
3. **Persona A/B 测试**: 可以添加机制测试不同人设的教学效果
4. **跨课堂一致性**: 同一个学生在不同课堂与同一个 agent 交互，可以考虑保持记忆

---

## 10. 结论

OpenMAIC 的 AI agent 人设系统设计清晰、职责分离良好。4 个物理老师的 persona：

1. ✅ **已正确注册** 在 `DEFAULT_AGENTS` 中
2. ✅ **会正确持久化** 通过 Zustand persist middleware
3. ✅ **会正确注入** 到 LLM system prompt 中
4. ✅ **会正确应用** 在实时对话和课堂生成中

系统的核心优势是解耦的分层架构：数据层、展示层、编排层、生成层各司其职，使得扩展新 agent（如添加更多学科教师）非常简单——只需在 `DEFAULT_AGENTS` 中添加新配置即可。
