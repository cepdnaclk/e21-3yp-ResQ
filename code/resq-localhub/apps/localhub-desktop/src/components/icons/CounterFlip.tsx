import React, { useEffect, useRef, useState } from "react";

export default function CounterFlip({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const [flip, setFlip] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      setFlip(true);
      const t = setTimeout(() => {
        setDisplay(value);
        setFlip(false);
        prev.current = value;
      }, 300);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span className={`counter-flip ${flip ? 'counter-flip--flip' : ''}`} aria-live="polite">
      {display}
    </span>
  );
}
