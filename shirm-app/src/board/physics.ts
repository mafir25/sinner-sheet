// «Живая» физика доски на d3-force — чисто визуальный слой.
// Старая Ширма разлеталась, потому что отталкивание узлов там ничем не было ограничено.
// Здесь у каждого узла есть «дом» — его сохранённая позиция, — пружины связей имеют длину,
// равную расстоянию между домами, а отталкивание действует только на коротких дистанциях.
// Поэтому в покое раскладка совпадает с сохранённой, а при перетаскивании соседи пружинят
// и возвращаются. Физика никогда не пишет в базу — якоря больше не нужны.
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { type FrameItem, type ItemMap, isFrame, isLink, isNode } from '../model/schema';

export type SimNode = SimulationNodeDatum & { id: string; homeX: number; homeY: number; r: number; frameId: string | null };
type SimLink = SimulationLinkDatum<SimNode> & { key: string; len: number };

export class Physics {
  private sim: Simulation<SimNode, SimLink>;
  private nodes = new Map<string, SimNode>();
  private frames = new Map<string, FrameItem>();
  private linkKey = '';
  private grabbed = new Set<string>();
  private raf = 0;

  constructor(private render: (nodes: Map<string, SimNode>) => void) {
    this.sim = forceSimulation<SimNode, SimLink>([])
      .alpha(0).alphaMin(0.003).alphaDecay(0.04).velocityDecay(0.35)
      .force('home-x', forceX<SimNode>((d) => d.homeX).strength(0.07))
      .force('home-y', forceY<SimNode>((d) => d.homeY).strength(0.07))
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance((l) => l.len).strength(0.12))
      .force('charge', forceManyBody<SimNode>().strength(-30).distanceMax(130))
      .force('collide', forceCollide<SimNode>((d) => d.r + 16).strength(0.7).iterations(2))
      .force('frames', () => this.keepInFrames())
      .on('tick', () => this.render(this.nodes));
    this.sim.stop();
  }

  /** Синхронизация с данными доски. intro — красиво «собрать» узлы при открытии. */
  sync(items: ItemMap, radius: (n: { size: number }) => number, intro: boolean) {
    const seen = new Set<string>();
    let structural = false, jumped = false;
    for (const it of Object.values(items)) {
      if (!isNode(it)) continue;
      seen.add(it.id);
      let n = this.nodes.get(it.id);
      if (!n) {
        n = { id: it.id, x: it.x, y: it.y, homeX: it.x, homeY: it.y, r: radius(it), frameId: it.frameId };
        this.nodes.set(it.id, n);
        structural = true;
        continue;
      }
      n.r = radius(it); n.frameId = it.frameId;
      if (n.homeX === it.x && n.homeY === it.y) continue;
      n.homeX = it.x; n.homeY = it.y;
      if (this.grabbed.has(it.id)) { n.fx = it.x; n.fy = it.y; }
      else { n.x = it.x; n.y = it.y; n.vx = n.vy = 0; jumped = true; } // отмена, правка другого админа и т.п.
    }
    for (const id of [...this.nodes.keys()]) if (!seen.has(id)) { this.nodes.delete(id); this.grabbed.delete(id); structural = true; }

    this.frames.clear();
    for (const it of Object.values(items)) if (isFrame(it) && it.variant === 'frame') this.frames.set(it.id, it);

    const links: SimLink[] = [];
    for (const it of Object.values(items)) {
      if (!isLink(it)) continue;
      const a = this.nodes.get(it.from), b = this.nodes.get(it.to);
      if (!a || !b || a === b) continue;
      links.push({ key: it.id, source: a, target: b, len: Math.max(40, Math.hypot(a.homeX - b.homeX, a.homeY - b.homeY)) });
    }
    const key = links.map((l) => `${l.key}:${Math.round(l.len)}`).join('|');
    if (structural) this.sim.nodes([...this.nodes.values()]);
    if (structural || key !== this.linkKey) {
      this.linkKey = key;
      (this.sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
    }

    if (intro && this.nodes.size) {
      // стартуем из «сжатого» облака вокруг центра — узлы разлетаются по своим местам
      let cx = 0, cy = 0;
      for (const n of this.nodes.values()) { cx += n.homeX; cy += n.homeY; }
      cx /= this.nodes.size; cy /= this.nodes.size;
      for (const n of this.nodes.values()) {
        const j = () => (Math.random() - 0.5) * 30;
        n.x = cx + (n.homeX - cx) * 0.55 + j();
        n.y = cy + (n.homeY - cy) * 0.55 + j();
        n.vx = n.vy = 0;
      }
      this.heat(0.9);
    } else if (this.grabbed.size) {
      this.heat(0.3);
    } else if (structural) {
      this.heat(0.2);
    }
    // даже без нагрева надо отрисовать мгновенные перемещения
    if (jumped || structural) this.scheduleRender();
  }

  /** Схватить узлы и держать их в указанных точках (перетаскивание). */
  grab(targets: Map<string, { x: number; y: number }>) {
    for (const [id, p] of targets) {
      const n = this.nodes.get(id); if (!n) continue;
      this.grabbed.add(id);
      n.fx = p.x; n.fy = p.y;
    }
    this.heat(0.3);
  }

  /** Отпустить. keep=true — новые позиции уже сохранены (админ); false — узел пружиной вернётся домой. */
  release(keep: boolean) {
    for (const id of this.grabbed) {
      const n = this.nodes.get(id); if (!n) continue;
      if (keep && n.fx != null) { n.x = n.fx; n.y = n.fy!; }
      n.fx = n.fy = null; n.vx = n.vy = 0;
    }
    this.grabbed.clear();
    this.heat(0.35);
  }

  /** Встряхнуть: случайный толчок всем узлам. */
  shake() {
    for (const n of this.nodes.values()) {
      if (n.fx != null) continue;
      const a = Math.random() * Math.PI * 2, v = 8 + Math.random() * 14;
      n.vx = Math.cos(a) * v; n.vy = Math.sin(a) * v;
    }
    this.heat(0.8);
  }

  stop() {
    this.sim.stop();
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.nodes.clear(); this.grabbed.clear(); this.linkKey = '';
    this.sim.nodes([]);
  }

  private heat(alpha: number) {
    this.sim.alpha(Math.max(this.sim.alpha(), alpha)).restart();
  }

  private scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(this.nodes); });
  }

  /** Узлы рамки не выходят за её края (кроме тех, что тащат прямо сейчас). */
  private keepInFrames() {
    for (const n of this.nodes.values()) {
      if (!n.frameId || n.fx != null) continue;
      const f = this.frames.get(n.frameId); if (!f) continue;
      const m = n.r + 6, top = 34;
      const x0 = f.x + m, x1 = f.x + f.w - m, y0 = f.y + top + m, y1 = f.y + f.h - m - 14;
      if (x0 < x1) { if (n.x! < x0) { n.x = x0; n.vx = 0; } else if (n.x! > x1) { n.x = x1; n.vx = 0; } }
      if (y0 < y1) { if (n.y! < y0) { n.y = y0; n.vy = 0; } else if (n.y! > y1) { n.y = y1; n.vy = 0; } }
    }
  }
}
