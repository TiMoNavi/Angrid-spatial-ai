import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { roomProject } from './fixtures/project';
import { layoutRecipes } from '$lib/ai/layouts';
import { applyAgentOps } from '$lib/utils/agentOps';
import { layoutRevision, layoutToAgentOps, previewLayout } from '$lib/utils/layoutAssistant';
import { readProject } from '$lib/utils/projectValidation';

function largeRoom() {
  const project = roomProject();
  for (const wall of project.floors[0].walls) {
    wall.start = { x: wall.start.x * 2.5, y: wall.start.y * 2.5 };
    wall.end = { x: wall.end.x * 2.5, y: wall.end.y * 2.5 };
  }
  return project;
}

describe('local layout preview and atomic ops', () => {
  it('loads local recipes and proposes a living-room arrangement without modifying the project', () => {
    expect(layoutRecipes.map(recipe => recipe.id)).toEqual(expect.arrayContaining(['living', 'work']));
    const project = largeRoom();
    const revision = layoutRevision(project, project.activeFloorId);
    const proposal = previewLayout(project, { preset: 'living' });
    expect(proposal.placements.map(item => item.catalogId)).toEqual(['sofa', 'coffee_table', 'chair']);
    expect(proposal.revision).toBe(revision);
    expect(project.floors[0].furniture).toHaveLength(0);
    for (const item of proposal.placements) {
      expect(item.position.x).toBeGreaterThan(0);
      expect(item.position.x).toBeLessThan(1000);
      expect(item.position.y).toBeGreaterThan(0);
      expect(item.position.y).toBeLessThan(750);
    }
    const { project: placed, changed } = applyAgentOps(project, layoutToAgentOps(proposal));
    expect(changed).toHaveLength(3);
    expect(placed.floors[0].furniture).toHaveLength(3);
    expect(layoutRevision(placed, placed.activeFloorId)).not.toBe(revision);
  });

  it('avoids existing furniture and rejects invalid or unbounded requests', () => {
    const project = largeRoom();
    project.floors[0].furniture.push({ id: 'existing', catalogId: 'sofa', position: { x: 500, y: 375 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } });
    const result = previewLayout(project, { preset: 'single', catalogId: 'chair' });
    const point = result.placements[0].position;
    expect(Math.abs(point.x - 500) >= 155 || Math.abs(point.y - 375) >= 100).toBe(true);
    expect(() => previewLayout(project, { preset: 'single', catalogId: 'sym_outlet' })).toThrow();
    expect(() => previewLayout(project, { preset: 'single', catalogId: 'chair', clearanceCm: 100 })).toThrow();
    project.floors[0].walls = [];
    expect(() => previewLayout(project, { preset: 'single', catalogId: 'chair' })).toThrow('closed room');
  });

  it('avoids structural footprints and invalidates proposals when the floor changes', () => {
    const project = largeRoom();
    const before = layoutRevision(project, project.activeFloorId);
    project.floors[0].columns.push({ id: 'column-center', position: { x: 500, y: 375 }, rotation: 0,
      shape: 'square', diameter: 400, height: 250, color: '#888888' });
    expect(layoutRevision(project, project.activeFloorId)).not.toBe(before);
    const proposal = previewLayout(project, { preset: 'single', catalogId: 'chair' });
    const chair = proposal.placements[0];
    const width = chair.rotation === 90 ? chair.depth : chair.width;
    const depth = chair.rotation === 90 ? chair.width : chair.depth;
    expect(Math.abs(chair.position.x - 500) >= (400 + width) / 2 + 15 ||
      Math.abs(chair.position.y - 375) >= (400 + depth) / 2 + 15).toBe(true);
  });

  it('applies a single item to the connected-dimensions import fixture', () => {
    const raw = JSON.parse(readFileSync(new URL('./fixtures/connected-dimensions.openplan.json', import.meta.url), 'utf8'));
    const project = readProject(raw);
    const proposal = previewLayout(project, { preset: 'single', catalogId: 'chair' });
    const result = applyAgentOps(project, layoutToAgentOps(proposal));
    expect(result.project.floors[0].furniture.at(-1)?.catalogId).toBe('chair');
  });
  it('copies nested positions out of reactive proxies before the project validation step', () => {
    const project = largeRoom();
    const proposal = previewLayout(project, { preset: 'single', catalogId: 'chair' });
    proposal.placements[0].position = new Proxy(proposal.placements[0].position, {});
    const result = applyAgentOps(project, layoutToAgentOps(proposal));
    expect(result.project.floors[0].furniture.at(-1)?.catalogId).toBe('chair');
  });
});
