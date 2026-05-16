import { useEffect, useRef, useState, useCallback } from "react"
import type { BuildingState, Resident, ChatMessage } from "@/types"
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

  const engineRef = useRef<SimulationEngine | null>(null)

  useEffect(() => {
    const engine = new SimulationEngine(3000)

    engine.onTick = (state, res) => {
      setBuildingState(structuredClone(state))
      setResidents(structuredClone(res))
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

  function handleStart() {
    engineRef.current?.start()
    setIsRunning(true)
  }

  function handlePause() {
    engineRef.current?.pause()
    setIsRunning(false)
  }

  /**
   * Player sends a message.
   * M4 will route this through LLM analyze → PlayerAction.
   * For now inserts a player bubble directly so the UI is testable.
   */
  const handleSendMessage = useCallback((text: string) => {
    if (!buildingState || buildingState.isGameOver) return

    const msg: ChatMessage = {
      id: `player_${Date.now()}`,
      senderId: "player",
      senderName: "אתה",
      content: text,
      tick: buildingState.tick,
      type: "player",
    }

    // Inject into engine and get back the canonical snapshot — avoids a race
    // where a tick fires between the engine write and a separate functional setState,
    // which would cause the message to appear twice.
    const snapshot = engineRef.current?.injectChatMessages([msg])
    if (snapshot) setBuildingState(snapshot)
  }, [buildingState])

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
            disabled={isGameOver}
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
