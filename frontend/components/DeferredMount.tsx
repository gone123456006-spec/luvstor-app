import React, { useEffect, useState } from "react";

/** Mounts children shortly after the screen opens so the open animation stays smooth */
export default function DeferredMount({
  children,
  delay = 220,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return ready ? <>{children}</> : null;
}
