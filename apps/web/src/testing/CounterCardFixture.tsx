import { useState } from "react"

export default function CounterCardFixture(props: { title: string }) {
  const [count, setCount] = useState(0)

  return (
    <section aria-label={props.title}>
      <h1>{props.title}</h1>
      <p data-testid="counter-value">{count}</p>
      <button data-testid="counter-inc" onClick={() => setCount((value) => value + 1)}>
        Increment
      </button>
      <button data-testid="counter-reset" onClick={() => setCount(0)}>
        Reset
      </button>
    </section>
  )
}
