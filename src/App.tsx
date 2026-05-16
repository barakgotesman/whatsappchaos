import { useEffect, useRef, useState, useCallback } from "react"
import type { BuildingState, Resident, ChatMessage, SimulationEvent } from "@/types"
import { SimulationEngine } from "@/simulation/engine"
import { Button } from "@/components/ui/button"
import { StatusBar } from "@/components/StatusBar"
import { ChatWindow } from "@/components/ChatWindow"
import { ResidentPanel } from "@/components/ResidentPanel"
import { trace } from "@/dev/traceStore"
import { DEV_SEED_MESSAGES } from "@/dev/devSeeds"
import { DevInjectButton } from "@/components/dev/DevInjectButton"
import { DevBadge } from "@/components/dev/DevBadge"
import { DevPanel } from "@/components/dev/DevPanel"
import { generateResidentMessages } from "@/llm/residentSpeaker"
import { analyzeMessage, isLlmCircuitOpen } from "@/llm/groqClient"
import { SENDER_ID, PLAYER_DISPLAY_NAME, PLAYER_LLM_NAME } from "@/constants"

/**
 * Root component — owns the engine singleton and snapshot state.
 * Desktop layout: dark ambient page + centered iPhone frame.
 * Group info screen slides in over the chat when user taps the group name.
 */
export default function App() {
  const [buildingState, setBuildingState]     = useState<BuildingState | null>(null)
  const [residents, setResidents]             = useState<Resident[]>([])
  const [isRunning, setIsRunning]             = useState(false)
  const [showGroupInfo, setShowGroupInfo]     = useState(false)
  const [devPanelOpen, setDevPanelOpen]       = useState(false)
  // Set to true when the LLM circuit opens — pauses the engine and shows a fatal error screen
  const [llmFatal, setLlmFatal]               = useState(false)

  const engineRef    = useRef<SimulationEngine | null>(null)
  // Ref mirror of isRunning so the onTick closure always sees the current value
  const isRunningRef = useRef(false)

  useEffect(() => {
    const engine = new SimulationEngine(3000)

    /**
     * Called after every engine tick.
     * Updates React state, then fires LLM calls async so the chat doesn't stall.
     * LLM messages are injected back into the engine when they resolve.
     */
    engine.onTick = (state, res, events) => {
      setBuildingState(structuredClone(state))
      setResidents(structuredClone(res))
      triggerResidentSpeaking(events, res, state)
    }

    engine.onGameOver = (result, reason) => {
      setBuildingState((prev) =>
        prev ? { ...prev, isGameOver: true, gameResult: result, gameOverReason: reason } : prev
      )
    }

    engineRef.current = engine

    // Push initial snapshot before first tick so UI renders immediately.
    // Private field access via cast — isolated to this one-time init.
    const eng = engine as unknown as { state: BuildingState; residents: Resident[] }

    // In dev mode, seed the chat with fake messages so the UI is immediately testable.
    if (trace.isDevMode()) {
      eng.state.chatMessages = [...DEV_SEED_MESSAGES]
    }

    engine.onTick!(structuredClone(eng.state), structuredClone(eng.residents), [])
  }, [])

  /**
   * Fires async LLM calls for residents who should speak this tick.
   * Injects their messages into the engine when they resolve and pushes
   * a React state update so the chat bubble appears.
   *
   * @param events - events fired this tick (drives speaker selection)
   * @param snapshotResidents - resident snapshot from this tick
   * @param snapshotState - building state snapshot from this tick
   */
  /**
   * Checks whether the LLM circuit breaker has opened after a call returns null.
   * If it has, pauses the engine and sets the fatal error flag so the UI shows
   * "Game not available" instead of silently degrading.
   */
  function checkLlmFatal(): void {
    if (isLlmCircuitOpen()) {
      engineRef.current?.pause()
      isRunningRef.current = false
      setIsRunning(false)
      setLlmFatal(true)
    }
  }

  function triggerResidentSpeaking(
    events: SimulationEvent[],
    snapshotResidents: Resident[],
    snapshotState: BuildingState,
  ) {
    // Never fire LLM calls before the player has pressed Start
    if (!isRunningRef.current) return
    if (events.length === 0 && snapshotState.tick % 3 !== 0) return  // skip quiet ticks

    generateResidentMessages(events, snapshotResidents, snapshotState).then((messages) => {
      if (isLlmCircuitOpen()) { checkLlmFatal(); return }
      if (!messages.length) return
      const newState = engineRef.current?.injectChatMessages(messages)
      if (newState) setBuildingState(newState)
    })
  }

  function handleStart() {
    const engine = engineRef.current
    if (!engine) return

    // On first start (tick === 0), inject the "promoted to admin" system notice
    const eng = engine as unknown as { state: BuildingState }
    if (eng.state.tick === 0) {
      const promoMsg: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: SENDER_ID.SYSTEM,
        senderName: SENDER_ID.SYSTEM,
        content: "הוספת כמנהל קבוצה",   // "You were added as a group admin"
        tick: 0,
        type: "system",
      }
      const newState = engine.injectChatMessages([promoMsg])
      setBuildingState(newState)
    }

    engine.start()
    isRunningRef.current = true
    setIsRunning(true)
  }

  function handlePause() {
    engineRef.current?.pause()
    isRunningRef.current = false
    setIsRunning(false)
  }

  /**
   * Player sends a message.
   * 1. Immediately inserts the player bubble into the chat.
   * 2. Async: calls LLM analyze → PlayerAction → engine.applyPlayerAction.
   * 3. Async: generates LLM reactions from affected residents.
   */
  const handleSendMessage = useCallback((text: string) => {
    if (!buildingState || buildingState.isGameOver) return
    const engine = engineRef.current
    if (!engine) return

    // 1. Show player bubble immediately — don't wait for LLM
    const msg: ChatMessage = {
      id: `player_${Date.now()}`,
      senderId: SENDER_ID.PLAYER,
      senderName: PLAYER_DISPLAY_NAME,
      content: text,
      tick: buildingState.tick,
      type: "player",
    }
    const afterPlayer = engine.injectChatMessages([msg])
    setBuildingState(afterPlayer)

    // 2. Analyze the player's message and apply game effects
    const stateSnapshot = afterPlayer
    analyzeMessage({
      callType: "analyze",
      playerMessage: text,
      activeIssues: stateSnapshot.activeIssues.filter((i) => !i.isResolved).map((i) => i.type),
      chaosLevel: stateSnapshot.chaosLevel,
      residents: residents.map((r) => ({ id: r.id, name: r.name, sentiment: r.currentSentiment })),
      recentMessages: stateSnapshot.chatMessages.slice(-5).map((m) => `${m.senderId === SENDER_ID.PLAYER ? PLAYER_LLM_NAME : m.senderName}: ${m.content}`),
    }).then((result) => {
      // null = circuit opened during this call
      if (result === null) { checkLlmFatal(); return }

      trace.traceLLM({
        callType: "analyze",
        prompt: text,
        rawResponse: JSON.stringify(result.action),
        parsed: result.action,
        success: !result.fallbackUsed,
        fallbackUsed: result.fallbackUsed,
        latencyMs: 0,  // latency tracked server-side
        tick: stateSnapshot.tick,
      })

      engine.applyPlayerAction(result.action)

      // 3. Generate reactions — force at least one resident to reply to the player
      generateResidentMessages([], residents, stateSnapshot, true).then((reactions) => {
        if (isLlmCircuitOpen()) { checkLlmFatal(); return }
        if (!reactions.length) return
        const newState = engine.injectChatMessages(reactions)
        setBuildingState(newState)
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingState, residents])

  /**
   * Dev-only: appends a batch of fake messages directly into state.
   * Bypasses the engine so it works whether the simulation is running or paused.
   */
  const handleDevInject = useCallback((messages: ChatMessage[]) => {
    const snapshot = engineRef.current?.injectChatMessages(messages)
    if (snapshot) setBuildingState(snapshot)
  }, [])

  const isGameOver = buildingState?.isGameOver ?? false
  const gameResult = buildingState?.gameResult
  const hasStarted = (buildingState?.tick ?? 0) > 0 || isRunning

  return (
    <div className="wa-page">
      {/* Dev inject button — only rendered when ?dev=1 */}
      {trace.isDevMode() && buildingState && (
        <DevInjectButton
          currentTick={buildingState.tick}
          onInject={handleDevInject}
        />
      )}

      {/* Ambient background blooms */}
      <div className="wa-bloom w-64 h-64 top-20 left-20 opacity-30" />
      <div className="wa-bloom w-96 h-96 bottom-20 right-20 opacity-20" />

      {/* ── iPhone frame ── */}
      <div className="wa-phone">
        {/* Dynamic Island */}
        <div className="wa-notch" />

        {/* Chat header — tapping group name opens group info */}
        {buildingState && (
          <StatusBar
            state={buildingState}
            onGroupNameClick={() => setShowGroupInfo(true)}
          />
        )}

        {/* Chat + input */}
        {buildingState && (
          <ChatWindow
            messages={buildingState.chatMessages}
            onSendMessage={handleSendMessage}
            disabled={isGameOver || llmFatal}
          />
        )}

        {/* Home bar */}
        <div className="wa-home-bar" />

        {/* Group info screen — slides over chat when group name tapped */}
        {showGroupInfo && (
          <ResidentPanel
            residents={residents}
            onClose={() => setShowGroupInfo(false)}
          />
        )}

        {/* Start overlay */}
        {!isRunning && !isGameOver && !showGroupInfo && (
          <div className="wa-start-overlay">
            <Button onClick={handleStart} variant="ghost" className="wa-start-btn">
              {hasStarted ? "המשך" : "התחל משחק"}
            </Button>
          </div>
        )}

        {/* Pause pill */}
        {isRunning && !isGameOver && !showGroupInfo && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30">
            <Button
              onClick={handlePause}
              variant="ghost"
              size="sm"
              className="wa-pause-btn"
            >
              השהה
            </Button>
          </div>
        )}

        {/* LLM fatal error overlay — shown when the circuit breaker opens */}
        {llmFatal && (
          <div className="wa-gameover">
            <div className="wa-gameover-card">
              <div className="text-5xl mb-4">⚠️</div>
              <div className="wa-gameover-title">המשחק אינו זמין</div>
              <div className="wa-gameover-reason">שגיאת תקשורת קריטית עם שרת הבינה המלאכותית</div>
              <Button onClick={() => window.location.reload()} className="wa-start-btn">
                נסה שוב
              </Button>
            </div>
          </div>
        )}

        {/* Game over overlay */}
        {isGameOver && (
          <div className="wa-gameover">
            <div className="wa-gameover-card">
              <div className="text-5xl mb-4">{gameResult === "win" ? "🏆" : "🗳️"}</div>
              <div className="wa-gameover-title">
                {gameResult === "win" ? "ניצחת!" : "הפסדת"}
              </div>
              <div className="wa-gameover-reason">{buildingState?.gameOverReason}</div>
              <Button onClick={() => window.location.reload()} className="wa-start-btn">
                משחק חדש
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dev panel + badge — only when ?dev=1 */}
      {trace.isDevMode() && (
        <>
          {devPanelOpen && <DevPanel />}
          <DevBadge open={devPanelOpen} onToggle={() => setDevPanelOpen((o) => !o)} />
        </>
      )}
    </div>
  )
}
