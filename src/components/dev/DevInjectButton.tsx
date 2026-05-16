import { useState } from "react"
import { Button } from "@/components/ui/button"
import { makeDevInjectBatch } from "@/dev/devSeeds"
import type { ChatMessage } from "@/types"

interface DevInjectButtonProps {
  /** Current tick so injected messages have sequential timestamps */
  currentTick: number
  /** Callback to append new messages into the game state */
  onInject: (messages: ChatMessage[]) => void
}

/**
 * Floating dev button — visible only when ?dev=1.
 * Each click appends a fresh batch of fake resident messages so
 * scroll-to-bottom and bubble append behavior can be tested repeatedly.
 */
export function DevInjectButton({ currentTick, onInject }: DevInjectButtonProps) {
  // Counter used as unique id prefix so repeated injections don't collide on React keys
  const [count, setCount] = useState(0)

  function handleInject() {
    const batch = makeDevInjectBatch(`inject_${count}`, currentTick)
    onInject(batch)
    setCount((c) => c + 1)
  }

  return (
    <button
      onClick={handleInject}
      className="wa-dev-inject-btn"
      title="Inject fake messages (dev only)"
    >
      💬 +msg
    </button>
  )
}
