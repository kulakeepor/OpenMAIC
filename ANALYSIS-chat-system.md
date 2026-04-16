# OpenMAIC 对话与讨论系统架构分析

> 生成日期: 2026-04-16
> 分析范围: 聊天、对话、讨论相关组件和 API

---

## 1. 系统概览

OpenMAIC 项目采用**无状态前端驱动**的对话架构，支持三种会话类型：
- **QA (问答)**：学生向 AI 老师提问的单轮对话
- **Discussion (讨论)**：AI 老师发起的多 Agent 讨论
- **Lecture (讲座)**：自动化的教学内容演示（语音 + 动作）

---

## 2. 核心文件结构

### 2.1 前端组件 (`components/`)

| 文件 | 功能 |
|------|------|
| `chat/chat-area.tsx` | 主聊天面板容器，包含 Notes 和 Chat 两个标签页 |
| `chat/chat-session.tsx` | 单个会话的渲染，消息气泡、动画、中断标记 |
| `chat/use-chat-sessions.ts` | 核心状态管理 hook，管理会话生命周期 |
| `chat/session-list.tsx` | 会话列表展示 |
| `chat/process-sse-stream.ts` | SSE 流解析器 |
| `chat/lecture-notes-view.tsx` | 讲座笔记视图 |
| `chat/proactive-card.tsx` | 主动建议卡片 |

### 2.2 PBL 场景相关组件 (`components/scene-renderers/pbl/`)

| 文件 | 功能 |
|------|------|
| `chat-panel.tsx` | PBL 聊天面板，支持 @mention 语法 |
| `use-pbl-chat.ts` | PBL 聊天 hook，处理 @mention 路由和问题完成逻辑 |
| `workspace.tsx` | PBL 工作空间主容器 |
| `guide.tsx` | PBL 引导指南 |
| `issueboard-panel.tsx` | 问题看板 |

### 2.3 API 路由 (`app/api/`)

| 路由 | 功能 |
|------|------|
| `chat/route.ts` | 主聊天 API，处理 QA/Discussion/Lecture |
| `pbl/chat/route.ts` | PBL 专用聊天 API，处理 @mention 路由 |

### 2.4 核心库 (`lib/`)

| 目录/文件 | 功能 |
|-----------|------|
| `orchestration/stateless-generate.ts` | 无状态生成逻辑，LangGraph 编排 |
| `orchestration/director-graph.ts` | LangGraph 状态图，多 Agent 调度 |
| `orchestration/director-prompt.ts` | Director 提示词构建 |
| `orchestration/prompt-builder.ts` | 结构化提示词构建 |
| `buffer/stream-buffer.ts` | 统一展示节奏控制层 |
| `types/chat.ts` | 聊天系统类型定义 |
| `chat/action-translations.ts` | 动作翻译 |

---

## 3. 消息发送和接收机制

### 3.1 主聊天流程 (QA/Discussion)

```
用户输入
    ↓
createSession() / sendMessage()
    ↓
构建 StatelessChatRequest (messages + storeState)
    ↓
POST /api/chat
    ↓
statelessGenerate() (LangGraph orchestration)
    ↓
Director 决定下一个发言者
    ↓
AI SDK 生成内容
    ↓
SSE 流返回事件
    ↓
processSSEStream() 解析
    ↓
StreamBuffer 处理节奏控制
    ↓
React 状态更新
```

### 3.2 SSE 事件流

| 事件类型 | 说明 |
|----------|------|
| `agent_start` | Agent 开始发言，创建新消息气泡 |
| `text_delta` | 文本增量更新 |
| `action` | 动作执行（spotlight、laser、discussion） |
| `thinking` | 思考状态更新（director/agent_loading） |
| `cue_user` | 提示用户输入 |
| `done` | 当前回合完成 |
| `error` | 错误事件 |

### 3.3 StreamBuffer 节奏控制

**核心设计**：统一的展示节奏层，在数据源（SSE/PlaybackEngine）和 React 状态之间。

```typescript
// 配置项
interface StreamBufferOptions {
  tickMs?: number;        // 默认 30ms
  charsPerTick?: number;   // 默认 1 字符/tick (~33 字符/秒)
  postTextDelayMs?: number;  // 文本显示后的停顿
  actionDelayMs?: number;     // 动作后的延迟
}
```

**工作原理**：
1. 事件进入队列（`pushAgentStart`, `pushText`, `pushAction` 等）
2. tick 循环以固定速率处理队列
3. 文本按 `charsPerTick` 逐字显示（打字机效果）
4. 动作仅在文本完全显示后触发
5. 支持 pause/resume

---

## 4. AI Agent 回复生成方式

### 4.1 多 Agent 编排（LangGraph）

```
START → director ──(end)──→ END
        │
        └─(next)→ agent_generate ──→ director (loop)
```

**Director 节点策略**：

| Agent 数量 | 策略 |
|------------|--------|
| 单 Agent | 纯代码逻辑，turn 0 派发 sole agent，turn 1+ 提示用户 |
| 多 Agent + triggerAgentId | 第一回合跳过 LLM，直接派发 trigger agent |
| 多 Agent (常规) | LLM 决定下一个发言者 / USER / END |

### 4.2 结构化输出格式

LLM 返回 JSON 数组，支持文本和动作交错：

```json
[
  {"type": "action", "name": "spotlight", "params": {"elementId": "img_1"}},
  {"type": "text", "content": "同学们好，今天我们学习..."},
  {"type": "action", "name": "laser", "params": {"elementId": "img_2"}},
  {"type": "text", "content": "请看这个图表..."}
]
```

**解析器**（`parseStructuredChunk`）：
1. 使用 `partial-json` 增量解析不完整的 JSON
2. 使用 `jsonrepair` 修复未转义引号
3. 区分已完成的项和流式增量
4. 对于末尾未完成的 text 项，流式传输内容增量

---

## 5. 学生和 AI 老师之间的对话流

### 5.1 QA 模式（学生发起）

1. 用户输入文本
2. `sendMessage()` 创建或复用 QA 会话
3. 构建 `StatelessChatRequest`：
   - `messages`: 包含历史对话 + 新用户消息
   - `storeState`: 当前舞台/场景/白板状态
   - `config.agentIds`: 选中的 Agent IDs
4. 调用 `/api/chat` 获取响应
5. SSE 流返回 Agent 响应
6. `StreamBuffer` 控制显示节奏
7. Director 决定是否 cue 用户或结束

### 5.2 Discussion 模式（Agent 发起）

1. 用户触发 `startDiscussion(topic, prompt)`
2. 创建类型为 `discussion` 的会话
3. 首次调用跳过 LLM，直接派发 `triggerAgentId`
4. 后续回合由 Director 通过 LLM 决定下一个发言者
5. 支持多 Agent 轮流对话
6. 最大轮数限制（默认 10 轮）

### 5.3 中断和恢复

| 操作 | 实现 |
|------|------|
| `endSession()` | 终止会话，追加 "..." + interrupted 标记 |
| `softPauseActiveSession()` | 软暂停，中止 SSE 但保持 active 状态 |
| `resumeActiveSession()` | 恢复会话，重新调用 `/api/chat` |
| `pauseBuffer()` / `resumeBuffer()` | 暂停/恢复显示节奏 |

---

## 6. 可复用的组件和接口

### 6.1 核心类型 (`lib/types/chat.ts`)

```typescript
// 会话类型
type SessionType = 'qa' | 'discussion' | 'lecture';
type SessionStatus = 'idle' | 'active' | 'interrupted' | 'completed';

// 会话定义
interface ChatSession {
  id: string;
  type: SessionType;
  title: string;
  status: SessionStatus;
  messages: UIMessage<ChatMessageMetadata>[];
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
  sceneId?: string;        // lecture 专用
  lastActionIndex?: number;  // lecture 专用
}

// 消息元数据
interface ChatMessageMetadata {
  senderName?: string;
  senderAvatar?: string;
  originalRole?: 'teacher' | 'agent' | 'user';
  agentId?: string;
  agentColor?: string;
  createdAt?: number;
  interrupted?: boolean;
}
```

### 6.2 无状态 API 请求/响应

```typescript
// 请求
interface StatelessChatRequest {
  messages: UIMessage<ChatMessageMetadata>[];
  storeState: {
    stage: Stage | null;
    scenes: Scene[];
    currentSceneId: string | null;
    mode: StageMode;
    whiteboardOpen: boolean;
  };
  config: {
    agentIds: string[];
    sessionType?: 'qa' | 'discussion';
    discussionTopic?: string;
    discussionPrompt?: string;
    triggerAgentId?: string;
    agentConfigs?: AgentConfig[];  // 生成的 Agent 配置
  };
  directorState?: DirectorState;  // 跨回合累积状态
  userProfile?: { nickname?: string; bio?: string };
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerType?: string;
}

// SSE 事件
type StatelessEvent =
  | { type: 'agent_start'; data: {...} }
  | { type: 'text_delta'; data: {...} }
  | { type: 'action'; data: {...} }
  | { type: 'thinking'; data: {...} }
  | { type: 'cue_user'; data: {...} }
  | { type: 'done'; data: {...} }
  | { type: 'error'; data: {...} };
```

### 6.3 StreamBuffer 接口

```typescript
export class StreamBuffer {
  // 推入方法
  pushAgentStart(data): void;
  pushAgentEnd(data): void;
  pushText(messageId, delta, agentId?): void;
  sealText(messageId): void;
  pushAction(data): void;
  pushThinking(data): void;
  pushCueUser(data): void;
  pushDone(data): void;
  pushError(message): void;

  // 控制方法
  start(): void;
  pause(): void;
  resume(): void;
  waitUntilDrained(): Promise<void>;
  dispose(): void;
  shutdown(): void;
}
```

### 6.4 ChatArea Ref 接口

```typescript
export interface ChatAreaRef {
  createSession(type, title): Promise<string>;
  endSession(sessionId): Promise<void>;
  endActiveSession(): Promise<void>;
  softPauseActiveSession(): Promise<void>;
  resumeActiveSession(): Promise<void>;
  sendMessage(content): Promise<void>;
  startDiscussion(request): Promise<void>;
  startLecture(sceneId): Promise<string>;
  addLectureMessage(sessionId, action, actionIndex): void;
  getIsStreaming(): boolean;
  getActiveSessionType(): string | null;
  getLectureMessageId(sessionId): string | null;
  pauseBuffer(sessionId): void;
  resumeBuffer(sessionId): void;
  pauseActiveLiveBuffer(): boolean;
  resumeActiveLiveBuffer(): void;
  switchToTab(tab: 'lecture' | 'chat'): void;
}
```

---

## 7. PBL 特殊机制

### 7.1 @mention 路由

```typescript
// 语法支持
@question    -> 路由到问题负责 Agent
@judge      -> 路由到评判 Agent
@agentName  -> 路由到指定 Agent
无 @mention  -> 默认路由到问题 Agent
```

### 7.2 问题完成流程

1. 评判 Agent 返回 "COMPLETE"（排除 "NEEDS_REVISION"）
2. 标记当前问题为完成（`is_done = true`）
3. 激活下一个未完成的问题（`is_active = true`）
4. 为新问题生成引导问题
5. 添加系统消息提示进度
6. 所有问题完成后显示完成消息

### 7.3 PBL API 请求

```typescript
interface PBLChatRequest {
  message: string;
  agent: PBLAgent;      // { name, system_prompt, ... }
  currentIssue: PBLIssue | null;
  recentMessages: { agent_name: string; message: string }[];
  userRole: string;
  agentType?: 'question' | 'judge';
}
```

---

## 8. 状态管理架构

### 8.1 会话状态流转

```
用户输入 → active (发送中)
    ↓
StreamBuffer 处理 → active (显示中)
    ↓
接收 done 事件 → completed (正常结束)
    ↓
用户中断 → interrupted + "..."
    ↓
用户恢复 → active (继续)
```

### 8.2 持久化

- 会话数据存储在 `useStageStore` 的 `chats` 字段
- 通过 `debouncedSave` 防抖保存到 IndexedDB
- 跨课程切换时重新加载会话
- 页面刷新时从存储恢复

### 8.3 前端 Agent 循环

`runAgentLoop()` 在 `use-chat-sessions.ts` 中实现：

1. 循环直到：maxTurns、END、cue_user、abort
2. 每次迭代：
   - 发送当前状态到 `/api/chat`
   - 处理 SSE 流
   - 等待 Buffer 排空
   - 检查 loopDoneDataRef 状态
   - 更新 directorState 传递给下一轮
3. 清理 AbortController 和状态

---

## 9. 关键设计模式

### 9.1 无状态后端

- 所有会话状态由前端维护
- 每次请求携带完整 `messages` + `storeState`
- 中断通过 `AbortSignal` 传播
- 心跳机制防止连接超时

### 9.2 统一的展示层

- `StreamBuffer` 作为单一真理源
- Chat Area 和 Roundtable 共享相同的节奏
- 支持 TTS 同步（`shouldHoldAfterReveal`）

### 9.3 结构化输出 + JSON Repair

- LLM 输出 JSON 数组格式
- `jsonrepair` 修复不合规 JSON
- `partial-json` 支持增量解析
- 动作和文本自由交错

### 9.4 LangGraph 编排

- 单一状态图拓扑（START → director → agent → END）
- 自定义 stream 模式实时推送事件
- Director 根据 Agent 数量自适应策略

---

## 10. 扩展点

### 10.1 添加新 Agent

1. 在 `lib/orchestration/registry/` 注册 Agent
2. 更新 `availableAgentIds` 列表
3. Director 自动适配

### 10.2 添加新动作

1. 在 `lib/orchestration/tool-schemas.ts` 定义动作 schema
2. 更新提示词包含新动作
3. StreamBuffer 自动处理

### 10.3 添加新会话类型

1. 扩展 `SessionType` 类型
2. 在 `use-chat-sessions.ts` 添加处理逻辑
3. 更新 Director 策略

---

## 11. 完整消息发送流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户界面层 (UI)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐      ┌──────────────────────┐      ┌──────────────┐   │
│  │  ChatArea    │◄─────┤   Roundtable        │◄─────┤ ChatPanel    │   │
│  │  (聊天区域)  │      │  (圆桌互动区域)      │      │ (PBL 聊天)   │   │
│  │ - Lecture    │      │  - 气泡显示          │      │              │   │
│  │   Notes 标签 │      │  - 用户输入          │      │ - @mention   │   │
│  │ - Chat 标签  │      │  - 语音输入          │      │ - 消息列表   │   │
│  └──────────────┘      └──────────────────────┘      └──────────────┘   │
│         │                        │                          │              │
│         └────────────────────────┼──────────────────────────┘              │
│                                  ▼                                         │
│                   ┌──────────────────────────────┐                           │
│                   │   ChatSessionComponent      │                           │
│                   │   (单会话消息展示)           │                           │
│                   │   - MessageBubble           │                           │
│                   │   - InlineActionTag         │                           │
│                   └──────────────────────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            状态管理层 (State)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  useChatSessions Hook                                            │     │
│  │  - sessions: ChatSession[]                                       │     │
│  │  - activeSessionId: string | null                                 │     │
│  │  - createSession() / sendMessage() / startDiscussion()             │     │
│  │  - runAgentLoop()  ← 前端驱动的多智能体循环                        │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                  │                                          │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  StreamBuffer (统一的展示节奏控制层)                              │     │
│  │  - pushAgentStart / pushText / pushAction / pushDone               │     │
│  │  - tick() 循环: 30ms/次, 1字符/tick                             │     │
│  │  - 回调: onTextReveal / onActionReady / onLiveSpeech             │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              网络层 (Network)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  POST /api/chat (SSE Stream)                                       │     │
│  │  Request: StatelessChatRequest {                                   │     │
│  │    messages, storeState, config, apiKey, model, directorState    │     │
│  │  }                                                                  │     │
│  │  Response: SSE Stream (StatelessEvent)                            │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心编排层 (Orchestration)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  statelessGenerate()                                              │     │
│  │  - 调用 createOrchestrationGraph() 构建 LangGraph                 │     │
│  │  - 流式返回 StatelessEvent                                        │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                  │                                          │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  DirectorGraph (LangGraph StateGraph)                             │     │
│  │  拓扑: START → director ──(end)──→ END                           │     │
│  │              │                                                    │     │
│  │              └─(next)→ agent_generate ──→ director (loop)        │     │
│  │                                                                    │     │
│  │  director 节点: 决定下一个发言的 Agent                           │     │
│  │  agent_generate 节点: 生成单个 Agent 的回复                        │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 总结

OpenMAIC 的对话系统采用**前端驱动、无状态后端**的架构，核心特点是：

1. **统一的展示节奏**：`StreamBuffer` 提供一致的打字机效果和动作延迟
2. **灵活的多 Agent 编排**：LangGraph + Director 支持 1-N 个 Agent
3. **结构化输出**：JSON 数组格式支持文本和动作交错
4. **完整的会话管理**：支持 QA、Discussion、Lecture 三种模式
5. **PBL 特殊机制**：@mention 路由和问题完成流程
6. **可中断和恢复**：支持暂停/恢复、软暂停等状态流转
