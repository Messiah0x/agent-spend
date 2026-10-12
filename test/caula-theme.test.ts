import { describe, expect, it } from "vitest";
import { layout } from "../src/ui.js";
import { mobilePolishCss } from "../src/mobile-polish.js";

describe("Caula product appearance", () => {
  const html = layout("Overview", { active: "overview", network: "Tempo Moderato" }, "<p>Dashboard</p>", "testnonce");
  it("uses the Caula identity and original-collar-derived logo", () => {
    expect(html).toContain("Caula home");
    expect(html).toContain("· Caula</title>");
    expect(html).toContain("data:image/svg+xml");
    expect(html).not.toContain("Agent Spend home");
  });
  it("includes a persisted light and dark theme selector", () => {
    expect(html).toContain("caula-theme");
    expect(html).toContain('dataset.theme');
    expect(mobilePolishCss).toContain(':root[data-theme="light"]');
    expect(mobilePolishCss).toContain('content:"CAULA"');
  });
});
