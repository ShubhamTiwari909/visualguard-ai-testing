import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSection } from "../client/project-section.js";
import type { Project } from "../shared/contracts.js";

const project: Project = {
  id: "storefront",
  publicId: "shop",
  name: "Storefront",
  runCount: 3,
  createdAt: "2026-10-19T00:00:00.000Z",
};
const render = (selected: Project | undefined, canManage: boolean) =>
  renderToStaticMarkup(
    createElement(ProjectSection, {
      project: selected,
      canManage,
      onDeleted: () => {},
    }),
  );

describe("selected project section", () => {
  it("shows project identity, run count and the confirmed deletion action for managers", () => {
    const html = render(project, true);
    expect(html).toContain('aria-label="Selected project"');
    expect(html).toContain("Storefront");
    expect(html).toContain("shop");
    expect(html).toContain("3 stored runs");
    expect(html).toContain('aria-label="Delete Storefront"');
    expect(html).toContain("Delete project");
    expect(html).not.toContain("Permanently delete project");
  });
  it("hides the deletion action for readers/reviewers", () => {
    const html = render(project, false);
    expect(html).toContain("Storefront");
    expect(html).not.toContain("Delete project");
  });
  it("does not offer deletion in the all-projects view", () => {
    expect(render(undefined, true)).toBe("");
  });
});
