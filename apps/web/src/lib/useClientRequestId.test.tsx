import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useClientRequestId } from "./useClientRequestId";

function Probe({ onId }: { onId: (id: string) => void }) {
  const id = useClientRequestId();
  onId(id);
  return <span data-testid="id">{id}</span>;
}

describe("useClientRequestId", () => {
  it("gera um UUID válido", () => {
    const ids: string[] = [];
    render(<Probe onId={(id) => ids.push(id)} />);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("mantém o mesmo id entre re-renders (retries)", () => {
    const ids: string[] = [];
    const { rerender } = render(<Probe onId={(id) => ids.push(id)} />);
    rerender(<Probe onId={(id) => ids.push(id)} />);
    rerender(<Probe onId={(id) => ids.push(id)} />);

    expect(new Set(ids).size).toBe(1);
  });

  it("gera um id diferente para uma nova montagem (nova tentativa)", () => {
    const idsA: string[] = [];
    const idsB: string[] = [];
    const { unmount } = render(<Probe onId={(id) => idsA.push(id)} />);
    unmount();
    render(<Probe onId={(id) => idsB.push(id)} />);

    expect(idsA[0]).not.toBe(idsB[0]);
  });
});
