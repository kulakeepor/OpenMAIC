/**
 * Path Engine — Adaptive Learning Path Recommendations
 *
 * Provides three pure functions for navigating the knowledge graph:
 *
 *   - `getRecommendedNode`  — picks the single best node to study next
 *   - `getLearningPath`     — returns the full prerequisite chain for a node
 *   - `getNextNodes`        — lists nodes that become unlockable after mastering
 *                             the current one
 *
 * All functions are dependency-free and operate entirely on in-memory data so
 * they can be used on both the server and the client without any I/O.
 */

import type { KnowledgeNode } from '@/lib/types/adaptive'

/** Mastery threshold above which a node is considered "mastered". */
const MASTERY_THRESHOLD = 0.8

export type LearningMapNodeStatus = 'locked' | 'available' | 'in_progress' | 'mastered'

export type LearningMapNode = KnowledgeNode & {
  status: LearningMapNodeStatus
  mastery: number
}

function getMastery(masteryByNode: Record<string, number>, nodeId: string): number {
  return masteryByNode[nodeId] ?? 0
}

function isNodeMastered(masteryByNode: Record<string, number>, nodeId: string): boolean {
  return getMastery(masteryByNode, nodeId) >= MASTERY_THRESHOLD
}

function lowestMastery(nodes: KnowledgeNode[], masteryByNode: Record<string, number>): KnowledgeNode | null {
  if (nodes.length === 0) {
    return null
  }

  return nodes.reduce((lowest, node) =>
    getMastery(masteryByNode, node.id) < getMastery(masteryByNode, lowest.id) ? node : lowest,
  )
}

// ─── getNextRecommendedNode ──────────────────────────────────────────────────

/**
 * 给定当前节点和所有节点的掌握度，推荐下一个学习节点
 * 优先级：
 * 1. 当前节点 prerequisites 的未掌握节点（补基础）
 * 2. 以当前节点为 prerequisite 的节点（往前走）
 * 3. 掌握度最低的相同 topic 节点
 * 4. 顺序下一个（fallback）
 */
export function getNextRecommendedNode(
  currentNodeId: string,
  nodes: KnowledgeNode[],
  masteryByNode: Record<string, number>,
): KnowledgeNode | null {
  const currentIndex = nodes.findIndex((node) => node.id === currentNodeId)
  if (currentIndex < 0) {
    return null
  }

  const currentNode = nodes[currentIndex]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  const unmetPrerequisites = currentNode.prerequisites
    .filter((nodeId) => !isNodeMastered(masteryByNode, nodeId))
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is KnowledgeNode => Boolean(node))

  const prerequisiteRecommendation = lowestMastery(unmetPrerequisites, masteryByNode)
  if (prerequisiteRecommendation) {
    return prerequisiteRecommendation
  }

  const forwardCandidates = nodes.filter((node) => {
    if (node.id === currentNodeId || isNodeMastered(masteryByNode, node.id)) {
      return false
    }

    if (!node.prerequisites.includes(currentNodeId)) {
      return false
    }

    return node.prerequisites
      .filter((nodeId) => nodeId !== currentNodeId)
      .every((nodeId) => isNodeMastered(masteryByNode, nodeId))
  })

  const forwardRecommendation = lowestMastery(forwardCandidates, masteryByNode)
  if (forwardRecommendation) {
    return forwardRecommendation
  }

  const sameTopicCandidates = nodes.filter((node) =>
    node.id !== currentNodeId &&
    node.topic === currentNode.topic &&
    !isNodeMastered(masteryByNode, node.id)
  )

  const sameTopicRecommendation = lowestMastery(sameTopicCandidates, masteryByNode)
  if (sameTopicRecommendation) {
    return sameTopicRecommendation
  }

  return nodes[currentIndex + 1] ?? null
}

// ─── getLearningMapNodes ─────────────────────────────────────────────────────

/**
 * 返回学习地图数据：每个节点 + 状态
 * status: 'locked' | 'available' | 'in_progress' | 'mastered'
 * mastered: mastery >= 0.8
 * in_progress: mastery > 0 && < 0.8
 * available: prerequisites 全部 mastered 或无 prerequisites
 * locked: 有未 mastered 的 prerequisites
 */
export function getLearningMapNodes(
  nodes: KnowledgeNode[],
  masteryByNode: Record<string, number>,
): LearningMapNode[] {
  return nodes.map((node) => {
    const mastery = getMastery(masteryByNode, node.id)
    const prerequisitesMastered = node.prerequisites.every((nodeId) =>
      isNodeMastered(masteryByNode, nodeId),
    )

    let status: LearningMapNodeStatus
    if (mastery >= MASTERY_THRESHOLD) {
      status = 'mastered'
    } else if (mastery > 0) {
      status = 'in_progress'
    } else if (prerequisitesMastered) {
      status = 'available'
    } else {
      status = 'locked'
    }

    return {
      ...node,
      status,
      mastery,
    }
  })
}

// ─── getRecommendedNode ───────────────────────────────────────────────────────

/**
 * Selects the single most appropriate node for a student to study next.
 *
 * Selection algorithm:
 * 1. A node is **eligible** when:
 *    - Every prerequisite node has mastery >= 0.8 in `masteryMap` (or the node
 *      has no prerequisites at all), **and**
 *    - The node's own mastery is below 0.8 (i.e., not yet mastered).
 * 2. Among all eligible nodes, the one with the **lowest difficulty** is
 *    returned (ties broken by the first occurrence in `allNodes`).
 * 3. If every node is already mastered (no eligible nodes), the node with the
 *    **lowest mastery level** is returned as a review candidate.
 * 4. Returns `null` when `allNodes` is empty.
 *
 * @param allNodes   Complete list of `KnowledgeNode` objects in the curriculum.
 * @param masteryMap Map of `nodeId → mastery` (0–1). Missing entries default to 0.
 * @returns          The recommended `KnowledgeNode`, or `null` if none exist.
 */
export function getRecommendedNode(
  allNodes: KnowledgeNode[],
  masteryMap: Record<string, number>,
): KnowledgeNode | null {
  if (allNodes.length === 0) {
    return null
  }

  const mastery = (id: string): number => masteryMap[id] ?? 0

  // Collect nodes that are unlocked (all prerequisites mastered) but not yet
  // mastered by the student.
  const eligible: KnowledgeNode[] = allNodes.filter((node) => {
    const selfMastery = mastery(node.id)
    if (selfMastery >= MASTERY_THRESHOLD) {
      return false // already mastered
    }
    return node.prerequisites.every((preId) => mastery(preId) >= MASTERY_THRESHOLD)
  })

  if (eligible.length > 0) {
    // Return the lowest-difficulty eligible node (stable: first-in-array wins ties).
    return eligible.reduce((best, node) =>
      node.difficulty < best.difficulty ? node : best,
    )
  }

  // All nodes are mastered — return the one with the lowest mastery for review.
  return allNodes.reduce((lowest, node) =>
    mastery(node.id) < mastery(lowest.id) ? node : lowest,
  )
}

// ─── getLearningPath ──────────────────────────────────────────────────────────

/**
 * Builds the full prerequisite chain leading up to (and including) `startNodeId`,
 * sorted so that earlier prerequisites appear before the nodes that depend on them.
 *
 * Algorithm:
 * 1. Recursively collect every ancestor of `startNodeId` via DFS, tracking
 *    visited IDs and an in-progress set to detect and skip cycles.
 * 2. Topological-sort the collected set: a node is emitted only after all of
 *    its prerequisites have already been emitted (Kahn's algorithm).
 * 3. `startNodeId` itself is always the last element of the returned array.
 *
 * Cycle handling: if a cycle is detected during DFS (a node is encountered
 * while still being explored), the back-edge is silently skipped — the
 * recursive call is aborted for that branch and processing continues normally.
 *
 * @param startNodeId  ID of the target node whose learning path is requested.
 * @param allNodes     Complete list of `KnowledgeNode` objects in the curriculum.
 * @returns            Ordered array from earliest prerequisite to `startNodeId`.
 *                     Returns `[]` if `startNodeId` is not found in `allNodes`.
 */
export function getLearningPath(
  startNodeId: string,
  allNodes: KnowledgeNode[],
): KnowledgeNode[] {
  // Build a fast lookup map.
  const nodeMap = new Map<string, KnowledgeNode>()
  for (const node of allNodes) {
    nodeMap.set(node.id, node)
  }

  if (!nodeMap.has(startNodeId)) {
    return []
  }

  // DFS — collect all ancestor node IDs (including startNodeId itself).
  const visited = new Set<string>()   // fully processed nodes
  const inStack = new Set<string>()   // nodes currently on the DFS call stack
  const collected = new Set<string>() // all reachable nodes (ancestors + self)

  function dfs(id: string): void {
    if (inStack.has(id)) {
      // Back-edge: cycle detected — skip to avoid infinite recursion.
      return
    }
    if (visited.has(id)) {
      // Already fully explored via a different path — just mark as collected.
      collected.add(id)
      return
    }

    inStack.add(id)

    const node = nodeMap.get(id)
    if (node) {
      collected.add(id)
      for (const preId of node.prerequisites) {
        dfs(preId)
      }
    }

    inStack.delete(id)
    visited.add(id)
  }

  dfs(startNodeId)

  // Topological sort (Kahn's algorithm) over the collected subgraph.
  // Only consider edges between collected nodes.
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>() // prerequisite → dependents

  for (const id of collected) {
    if (!inDegree.has(id)) inDegree.set(id, 0)
    if (!adjList.has(id)) adjList.set(id, [])
  }

  for (const id of collected) {
    const node = nodeMap.get(id)!
    for (const preId of node.prerequisites) {
      if (!collected.has(preId)) continue // prerequisite outside collected set
      // Edge: preId → id (preId must come before id)
      adjList.get(preId)!.push(id)
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: KnowledgeNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodeMap.get(id)
    if (node) sorted.push(node)

    for (const dependentId of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(dependentId) ?? 1) - 1
      inDegree.set(dependentId, newDeg)
      if (newDeg === 0) queue.push(dependentId)
    }
  }

  return sorted
}

// ─── getNextNodes ─────────────────────────────────────────────────────────────

/**
 * Returns the nodes that are directly unlocked once `currentNodeId` is mastered.
 *
 * A node is returned when **all** of the following are true:
 * - It lists `currentNodeId` as one of its prerequisites.
 * - Every *other* prerequisite of that node already has mastery >= 0.8 in
 *   `masteryMap` (so that mastering `currentNodeId` would fully unlock it).
 *
 * The results are sorted by `difficulty` in ascending order.
 *
 * @param currentNodeId  ID of the node the student has just (or is about to) master.
 * @param allNodes       Complete list of `KnowledgeNode` objects in the curriculum.
 * @param masteryMap     Map of `nodeId → mastery` (0–1). Missing entries default to 0.
 * @returns              Difficulty-sorted array of unlockable next nodes.
 */
export function getNextNodes(
  currentNodeId: string,
  allNodes: KnowledgeNode[],
  masteryMap: Record<string, number>,
): KnowledgeNode[] {
  const mastery = (id: string): number => masteryMap[id] ?? 0

  const candidates = allNodes.filter((node) => {
    // Must require currentNodeId as a prerequisite.
    if (!node.prerequisites.includes(currentNodeId)) {
      return false
    }
    // All *other* prerequisites must already be mastered.
    return node.prerequisites
      .filter((preId) => preId !== currentNodeId)
      .every((preId) => mastery(preId) >= MASTERY_THRESHOLD)
  })

  // Sort by difficulty ascending (stable relative to original array order).
  return candidates.slice().sort((a, b) => a.difficulty - b.difficulty)
}
