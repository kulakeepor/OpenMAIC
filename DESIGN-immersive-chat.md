# Immersive Chat / NPC 组件设计方案

本文基于 [ANALYSIS-chat-system.md](/Users/by/Claude/OpenMAIC-wt-2/ANALYSIS-chat-system.md:1) 中对现有对话系统的分析，设计 Step 3 的前端组件方案。

目标分两部分：

1. 在 `immersive` 场景播放时，学生可以随时向 AI 老师提问
2. 在讨论环节，AI 同学可以自动发言，并且具备可配置的头像、名字和说话风格

本文只做组件和交互设计，不包含代码实现。

---

## 1. 设计目标

### 1.1 用户目标

沉浸式场景不是传统课件页，它更接近“场景体验 + 旁白讲述”。因此用户对聊天入口的预期不是：

- 跳到右侧独立聊天区
- 切换 tab
- 打断当前页面结构

而是：

- 在当前场景里直接发问
- 不脱离沉浸感
- 问题和老师回答像“场景中的即时互动”

### 1.2 技术目标

新的 immersive 对话方案必须：

- 尽量复用现有 `useChatSessions`、`/api/chat`、`StreamBuffer`
- 不复制第二套对话引擎
- 与现有 `Roundtable` 讨论机制兼容
- 能和 `ImmersiveRenderer` 同时存在，不破坏当前 narration / formula / 背景图布局

---

## 2. 现状分析

## 2.1 当前对话系统适合什么

现有系统由以下模块构成：

- `ChatArea`
- `ChatSessionComponent`
- `useChatSessions`
- `processSSEStream`
- `StreamBuffer`
- `/api/chat`

它适合：

- 右侧固定聊天面板
- session 列表
- QA / discussion / lecture 的统一会话管理
- 持久化聊天记录

## 2.2 当前对话系统不适合什么

它不适合直接作为 immersive 内嵌交互层，原因有三点：

1. `ChatArea` 过重
   - 包含 Notes / Chat 标签
   - 包含会话列表和宽度调节
   - 默认是边栏容器，不是覆盖层

2. `ChatSessionComponent` 假设的是“连续消息列表”
   - 更像消息历史区
   - 不适合做轻量浮层问答泡泡

3. `ImmersiveRenderer` 当前是纯视觉组件
   - 没有任何 live interaction slot
   - 也没有把 narration 区和聊天层进行布局分工

结论：

- 不应该直接把 `ChatArea` 塞进 immersive 场景
- 应该新做一个“overlay 级别的 immersive-chat”
- 但底层会话引擎尽量复用 `useChatSessions + /api/chat + StreamBuffer`

---

## 3. 总体方案

建议引入两层新组件：

1. `ImmersiveChatOverlay`
   - 浮在 `ImmersiveRenderer` 上方
   - 负责用户提问、老师回答、轻量消息显示

2. `ImmersiveNpcStrip`
   - 浮在 immersive 场景的另一侧或底部边缘
   - 负责显示 AI 同学头像、名字、发言提示和简短发言气泡

它们与现有系统的关系：

- `ImmersiveRenderer` 继续负责视觉场景本体
- `ImmersiveChatOverlay` 负责“学生 ↔ 老师”的即时问答
- `ImmersiveNpcStrip` 负责“NPC 同学自动参与”
- 真正的对话引擎仍然复用现有 `useChatSessions` 和 `/api/chat`

---

## 4. Immersive Chat 组件方案

## 4.1 组件定位

建议新建：

- `components/immersive/immersive-chat-overlay.tsx`
- `components/immersive/immersive-chat-bubble.tsx`
- `components/immersive/immersive-chat-input.tsx`

也可以后续按复杂度收敛成一个文件，但职责上建议先拆。

## 4.2 布局位置

组件应浮在 `ImmersiveRenderer` 上方，采用“半透明悬浮对话框”。

建议布局：

- 默认停靠在右下角
- 不遮挡顶部 `historicalContext` badge
- 不完全盖住底部 `narrativeText`

推荐视觉层级：

- 背景：`bg-black/35` 或 `bg-slate-950/40`
- 模糊：`backdrop-blur-md`
- 边框：`border-white/10`
- 阴影：轻量浮层，不要做成厚重 modal

推荐尺寸策略：

- 桌面：宽 360px 到 420px，高度自适应，最大高度约屏幕 40%
- 移动端：全宽底部抽屉式展开，默认折叠为输入条

## 4.3 交互模式

immersive chat 不应默认一直展开。

建议有三种状态：

1. `collapsed`
   - 只显示一个轻量入口
   - 文案可为“向老师提问”
   - 若刚收到老师回复，可显示未读点或一行 preview

2. `input-focused`
   - 展开输入框和最近 1-2 条消息
   - 用户准备提问

3. `active-conversation`
   - 正在 streaming 或刚收到回复
   - 显示消息列表、发送框、关闭/折叠按钮

这与 `ChatArea` 的区别是：

- `ChatArea` 是会话中心
- `ImmersiveChatOverlay` 是场景内即时问答入口

## 4.4 推荐 Props

建议 `ImmersiveChatOverlay` 的 props 如下：

```ts
interface ImmersiveChatOverlayProps {
  sceneId: string;
  sceneTitle?: string;
  topic?: string;
  teacherAgentId: string;
  teacherName?: string;
  teacherAvatar?: string;
  visible?: boolean;
  collapsed?: boolean;
  currentNarration?: string | null;
  onCollapsedChange?: (collapsed: boolean) => void;
  onStreamingChange?: (streaming: boolean) => void;
  onMessageSent?: (message: string) => void;
  onSessionError?: (error: Error | string) => void;
}
```

理由：

- `sceneId`：用于将会话与当前 immersive scene 绑定
- `teacherAgentId`：确保 QA 只由老师回答，不让其他 agent 插入
- `currentNarration`：可选，用于后续把当前场景叙事注入 prompt 或 UI 提示
- `collapsed` / `onCollapsedChange`：给外层控制桌面/移动端状态

## 4.5 内部 State 设计

建议组件本地 state 保持轻量，不重复保存完整会话引擎状态。

本地 state：

```ts
interface ImmersiveChatUIState {
  collapsed: boolean;
  inputValue: string;
  visibleMessages: UIMessage<ChatMessageMetadata>[];
  activeSessionId: string | null;
  isStreaming: boolean;
  isThinking: boolean;
  unreadCount: number;
  lastError: string | null;
}
```

其中：

- `visibleMessages`
  - 不是全量历史会话仓库
  - 只维护当前 immersive scene 要显示的最近消息
- `activeSessionId`
  - 对应 `useChatSessions` 创建的 QA session
- `isStreaming` / `isThinking`
  - 来自 `useChatSessions` 的事件回调
- `unreadCount`
  - 用于 collapsed 状态的红点/计数

不建议在这里重新实现：

- Director state
- SSE parser
- Buffer 队列
- 完整消息数据库

这些都应该复用已有系统。

---

## 5. Immersive Chat 与 ChatArea 的区别和复用边界

## 5.1 可以复用的部分

### 5.1.1 必须复用

- `useChatSessions`
- `/api/chat`
- `StatelessChatRequest`
- `processSSEStream`
- `StreamBuffer`
- `ChatMessageMetadata`

这是整套实时对话的稳定基础设施，没必要再造一套。

### 5.1.2 可部分复用

- `ChatSessionComponent` 的消息气泡风格
- `AvatarDisplay` 的头像显示
- `Roundtable` 里的 live speech / thinking 反馈视觉语言

可复用的是“视觉语言”和“事件语义”，不是整个组件。

## 5.2 不应复用的部分

### 5.2.1 不直接复用 `ChatArea`

原因：

- 右侧边栏模型不适合 immersive overlay
- 会话列表、lecture notes、tab 都是噪音
- 会把沉浸场景破坏成 dashboard

### 5.2.2 不直接复用 `SessionList`

immersive 内不需要显示多 session 列表。一个 scene 内通常只需要：

- 1 个即时 QA 会话
- 或 1 个轻量 discussion 预览

## 5.3 推荐的复用方式

最佳方案不是“在 immersive 里再挂一个 `ChatArea`”，而是：

1. 提取 `useImmersiveChatSession` 轻包装 hook
2. 内部调用 `useChatSessions`
3. 对外只暴露 immersive 所需最小接口

例如：

```ts
interface UseImmersiveChatSessionResult {
  messages: UIMessage<ChatMessageMetadata>[];
  isStreaming: boolean;
  thinkingState: { stage: string; agentId?: string } | null;
  sendQuestion: (text: string) => Promise<void>;
  collapse: () => void;
  expand: () => void;
  endSession: () => Promise<void>;
}
```

这样能把现有复杂对话能力“适配”为沉浸式问答接口。

---

## 6. 与 StreamBuffer 的交互方式

## 6.1 设计原则

immersive chat 必须继续使用 `StreamBuffer`，理由：

- 现有系统已经保证 QA / discussion / roundtable 的节奏一致性
- 如果 immersive chat 不走 `StreamBuffer`，就会出现：
  - 右侧 chat 是打字机节奏
  - immersive overlay 是整段瞬间刷出
  - 用户感知割裂

## 6.2 具体交互方式

推荐方式：

- `ImmersiveChatOverlay` 不直接 new `StreamBuffer`
- 而是通过 `useChatSessions` 间接获取 buffer 驱动后的消息状态

数据流：

1. 用户在 overlay 输入问题
2. overlay 调用 `sendMessage()` 或专用 `sendQuestion()`
3. `useChatSessions` 创建 / 复用 QA session
4. `/api/chat` 返回 SSE
5. `processSSEStream` 把事件送进 `StreamBuffer`
6. `StreamBuffer` 按节奏触发消息更新
7. overlay 从 session messages / live callbacks 获得更新并渲染

## 6.3 对 immersive 特有的附加需求

immersive overlay 对 `StreamBuffer` 有两个特有诉求：

### 6.3.1 可以只显示“当前活动气泡”

和 `ChatArea` 不同，immersive overlay 不一定总要展示完整消息历史。

因此需要支持两种展示模式：

- `history`
  - 显示最近 N 条消息
- `focus`
  - streaming 时只放大显示当前老师回复气泡

底层 `StreamBuffer` 不用改，UI 侧根据 `activeBubbleId` 和消息列表决定怎么显示。

### 6.3.2 narration 与 QA 并行时的优先级

immersive 场景下有两类文本源：

- lecture narration
- live QA response

设计建议：

- 一旦用户发起 QA，overlay 只消费 QA session 的 buffer
- narration 继续在底部 narrative 区或场景字幕中保留，不和 QA 气泡混流
- 两条文本流不要共用一个视觉容器

换句话说：

- `StreamBuffer` 统一节奏
- 但不同 session 的输出应分层展示

---

## 7. Immersive 提问流程设计

## 7.1 用户操作流程

推荐交互：

1. 学生进入 immersive scene
2. 右下角看到“向老师提问”入口
3. 点击后展开 overlay
4. 输入问题并发送
5. overlay 显示：
   - thinking 状态
   - 老师头像
   - streaming 回复
6. 回复结束后：
   - overlay 保留最近 2-4 条问答
   - 可继续追问
   - 也可折叠回场景

## 7.2 QA 模式约束

Immersive chat 的默认模式应该是：

- 单老师 QA

即请求构造时：

- `sessionType = 'qa'`
- `agentIds = [teacherAgentId]`
- `defaultAgentId = teacherAgentId`

这样能保证：

- 问题先由老师答
- 不触发整个 multi-agent discussion loop
- 体验更像“随时插话问老师”

如果后续要扩展成：

- “我想听同学怎么看”

再显式升级为 `discussion` 模式。

## 7.3 场景上下文注入

为了让老师回答与 immersive scene 强相关，建议在请求层追加轻量上下文：

- 当前 scene title
- 当前 `narrativeText` 摘要
- 当前 `historicalContext`
- 当前 `keyFormulas`

这不一定要改后端协议结构，可以先走：

- `storeState.currentSceneId`
- 当前 `scene.content`

由前端包装进用户问题前缀或后续扩展 request 字段。

设计建议先保留扩展点，不在本轮强行改协议。

---

## 8. NPC 同学组件方案

## 8.1 目标

在 immersive 场景的讨论环节，AI 同学不是只在 `Roundtable` 场景里存在，而是应能在 immersive 体验中“自然冒出来”：

- 有头像
- 有名字
- 有一两句符合 persona 的发言
- 不要把整个界面切换成正式圆桌会

所以需要一个比 `Roundtable` 更轻、更场景化的 NPC 展示层。

## 8.2 组件建议

建议新建：

- `components/immersive/immersive-npc-strip.tsx`
- `components/immersive/immersive-npc-bubble.tsx`

职责：

- `ImmersiveNpcStrip`
  - 展示若干 NPC 头像条
  - 标记谁在说话、谁在思考
- `ImmersiveNpcBubble`
  - 在对应 NPC 附近弹出简短气泡
  - 显示 1-2 句学生评论 / 提问 / 吐槽 / 总结

## 8.3 推荐布局

推荐两种可切换样式：

### 方案 A：底部侧边角色条

- 左下或右下沿边排布 2-4 个 NPC 头像
- 发言时在头像上方冒泡

优点：

- 不打断 immersive 画面中心
- 风格更像“场景中的旁听同学”

### 方案 B：边缘浮层卡片

- 当前发言 NPC 以小卡片形式浮现在侧边
- 其他 NPC 只显示头像缩略条

优点：

- 信息密度更低
- 更适合移动端

建议默认采用方案 A。

---

## 9. NPC 配置方式

## 9.1 配置来源

NPC 配置不应另起一套 schema，优先复用现有 agent registry。

来源：

- `useAgentRegistry`
- `selectedAgentIds`
- `AgentConfig`

从中筛出：

- `role !== 'teacher'`

作为 immersive NPC 候选。

## 9.2 前端展示配置

建议在 immersive 层使用一个轻量映射对象：

```ts
interface ImmersiveNpcViewModel {
  id: string;
  name: string;
  avatar: string;
  color: string;
  role: 'assistant' | 'student';
  persona: string;
  speakingStyle?: 'curious' | 'playful' | 'analytical' | 'supportive';
}
```

这里的 `speakingStyle` 不需要后端额外存储，可以由前端从 persona 或默认角色映射推导：

- `好奇宝宝` -> `curious`
- `显眼包` -> `playful`
- `思考者` -> `analytical`
- `AI助教` -> `supportive`

作用主要是 UI 层：

- 气泡颜色
- 动效轻重
- 语气标签

## 9.3 说话风格配置方式

建议分两层：

### 底层真实风格

由后端 prompt / agent persona 决定。

### 前端视觉风格

由 `role + persona archetype` 推导：

- `curious`
  - 较亮色点缀
  - 问号型气泡
- `playful`
  - 弹跳型入场动画
  - 更轻的背景色
- `analytical`
  - 稳定淡入
  - 更克制的卡片风格
- `supportive`
  - 柔和色块
  - 简洁提示式气泡

这样 UI 有 personality，但不会和真实 LLM persona 脱节。

---

## 10. NPC 自动发言与现有 Roundtable 的关系

## 10.1 关系定位

`Roundtable` 适合：

- 正式 QA
- discussion action
- 多 agent 连续对话
- 带输入、带控制栏、带 presentation overlay 的复杂场景

`ImmersiveNpcStrip` 适合：

- immersive 场景中的轻量 NPC 插话
- 辅助式同学评论
- 不切离 immersive 视觉叙事

所以二者关系不是替代，而是分层：

- `Roundtable` = full discussion surface
- `ImmersiveNpcStrip` = lightweight discussion surface

## 10.2 复用什么

建议复用：

- `initialParticipants` 的来源逻辑
- `speakingAgentId`
- `thinkingState`
- `audioAgentId`
- `currentSpeech`
- `sessionType`

这些都已经在 `Stage -> Roundtable -> ChatArea` 链路中存在。

也就是说，NPC strip 不必重新推断谁在说话，而是复用现有 live session 状态。

## 10.3 不复用什么

不建议把 `Roundtable` 直接缩小嵌进 immersive scene，原因：

- 它内含大量控制栏、输入区、presentation 逻辑
- DOM 结构太重
- 视觉语义是“正式讨论”
- 与 immersive 的 cinematic 体验冲突

---

## 11. NPC 自动发言的前端表现

## 11.1 触发时机

NPC 自动发言应只在以下情况出现：

1. `discussion` session 正在进行
2. 当前发言 agent 不是 teacher，而是 student / assistant
3. immersive 场景允许 discussion overlay

不建议在普通 narration 阶段让 NPC 随机冒泡，否则会显得噪声太多。

## 11.2 展示策略

推荐策略：

- 同一时刻只突出一个 NPC 发言
- 其他 NPC 只显示头像高亮
- 发言文本只显示当前 buffer 正在 reveal 的 segment
- 文本结束后保留短暂气泡，再自动淡出

这与 `Roundtable` 当前“完整消息历史”模式不同，更像 transient overlay。

## 11.3 与 StreamBuffer 的关系

同样不单独建 buffer。

建议直接消费现有：

- `onLiveSpeech(text, agentId)`
- `onThinking(state)`
- `onSpeechProgress(ratio)`

由 `ImmersiveNpcStrip` 决定：

- 当前 `agentId` 是否是 NPC
- 若是，则在哪个 avatar 上显示气泡
- `speechProgress` 用于控制气泡内滚动或 reveal 状态

这能保证 NPC strip 与 `Roundtable` 在节奏上完全一致。

---

## 12. 组件层级建议

建议未来层级如下：

```tsx
<ImmersiveSceneShell>
  <ImmersiveRenderer />

  <ImmersiveNpcStrip
    participants={npcParticipants}
    speakingAgentId={speakingAgentId}
    currentSpeech={liveSpeech}
    thinkingState={thinkingState}
    sessionType={chatSessionType}
  />

  <ImmersiveChatOverlay
    sceneId={scene.id}
    teacherAgentId={teacherId}
    teacherName={teacherName}
    teacherAvatar={teacherAvatar}
    currentNarration={currentNarration}
  />
</ImmersiveSceneShell>
```

其中：

- `ImmersiveRenderer` 仍然是底层视觉
- NPC strip 和 chat overlay 都是视觉覆盖层
- 不直接耦合彼此，但共享 Stage 提供的 live discussion state

---

## 13. 状态来源建议

## 13.1 外层 Stage 提供

建议由 `Stage` 或 `scene-renderer` 向 immersive 层传入：

- `selectedAgentIds`
- `speakingAgentId`
- `liveSpeech`
- `thinkingState`
- `chatSessionType`
- `chatIsStreaming`

这样 immersive 层只关心展示，不主动理解整个 playback engine。

## 13.2 组件内部维护

由组件内部维护：

- overlay 是否展开
- 输入框内容
- unread 状态
- 当前只显示最近几条消息还是完整历史

原则：

- 会话事实从上层来
- 展示状态由组件自己管

---

## 14. 分阶段落地建议

## Phase 1

先做最小可用版本：

- `ImmersiveChatOverlay`
- 单老师 QA
- 复用 `useChatSessions`
- 不显示 NPC

目标：

- immersive 场景能随时提问

## Phase 2

加入轻量 NPC strip：

- 只显示当前 student / assistant 发言
- 复用现有 `speakingAgentId + liveSpeech`

目标：

- discussion 阶段不必切成完整 Roundtable 也能有群体感

## Phase 3

再做高级能力：

- scene-aware 上下文注入
- 移动端 drawer 版 immersive chat
- NPC 个性化视觉风格
- “展开到完整 ChatArea” 的桥接入口

---

## 15. 最终结论

最佳方案不是把现有 `ChatArea` 缩小塞进 immersive scene，而是：

- 在视觉层新建 `ImmersiveChatOverlay`
- 在角色层新建 `ImmersiveNpcStrip`
- 在引擎层继续复用 `useChatSessions + /api/chat + StreamBuffer`

这样做的好处是：

1. 保留现有无状态对话架构和多 agent 编排能力
2. 不复制 SSE、Buffer、Director 这套复杂系统
3. UI 更符合 immersive 场景的“随时插话式提问”体验
4. NPC 同学可以自然进入场景，而不是强行切换到正式圆桌模式

一句话总结：

**后端和状态层继续统一，前端在 immersive 场景上增加一层轻量、半透明、场景内嵌的交互壳。**

