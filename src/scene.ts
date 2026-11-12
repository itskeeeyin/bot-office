import * as THREE from 'three';
import { behaviourFor } from './behavior';
import type { Bot, LightMode, OfficeStatus, Status } from './types';
import { LOUNGE, MEETING, slotPosition, zoneLayout, ZONE_LAYOUTS, type ZoneLayout } from './zones';

export type OfficeHooks = {
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
};

type Agent = {
  id: string;
  root: THREE.Group;
  pivot: THREE.Group;
  parts: THREE.Mesh[];
  screen: THREE.Mesh;
  lamp: THREE.Mesh;
  alert: THREE.Sprite;
  ring: THREE.Mesh;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  seat: THREE.Vector3;
  stand: THREE.Vector3;
  meeting: THREE.Vector3;
  breaks: THREE.Vector3[];
  breakIndex: number;
  wander: number;
  phase: number;
  name: string;
  status: Status | null;
  task: string;
  pose: 'seated' | 'standing';
  typing: boolean;
  greyed: boolean;
  monitorGlow: boolean;
  lampOn: boolean;
  alertOn: boolean;
  facing: number;
  zoneColor: string;
};

const SHIRTS = [0x2f4e9e, 0x5b46b0, 0x1d7a56, 0xb56a22, 0x3d6fbf, 0x6a4e9e, 0x2a6b5a, 0x8a5a32, 0x44506e, 0x8d4d62];
const SKIN = 0xf0c7a4;
const PANTS = 0x2c3142;
const HAIR = 0x3a2a24;

export class Office {
  readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private readonly scene = new THREE.Scene();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hemi: THREE.HemisphereLight;
  private readonly dir: THREE.DirectionalLight;
  private readonly amb: THREE.AmbientLight;
  private readonly dynamic = new THREE.Group();
  private readonly hitTargets: THREE.Object3D[] = [];
  private agents: Agent[] = [];
  private label: THREE.Sprite;
  private labelText = '';
  private selected: string | null = null;
  private hovered: string | null = null;
  private signature = '';
  private running = false;
  private raf = 0;
  private last = 0;
  private reduceMotion: boolean;
  private light: LightMode = 'day';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: OfficeHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 80);
    this.camera.position.set(18, 20, 18);
    this.camera.lookAt(0, 0, 0);
    this.hemi = new THREE.HemisphereLight(0xfff6ea, 0xd9c3a5, 0.85);
    this.dir = new THREE.DirectionalLight(0xfff2dd, 1.05);
    this.dir.position.set(8, 18, 10);
    this.amb = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this.hemi, this.dir, this.amb, this.dynamic);
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.buildStatic();
    this.label = makeLabelSprite(' ');
    this.label.visible = false;
    this.scene.add(this.label);
    this.fit();
    this.applyLight('day');
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    window.addEventListener('resize', this.fit);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt, now / 1000);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setLight(mode: LightMode): void {
    this.light = mode;
    this.applyLight(mode);
  }

  setSelected(id: string | null): void {
    this.selected = id;
    this.refreshRings();
    this.refreshLabel();
  }

  setHovered(id: string | null): void {
    this.hovered = id;
    this.refreshLabel();
  }

  setData(data: OfficeStatus): void {
    const sig = data.bots.map((bot) => `${bot.id}@${bot.zone}`).join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild(data.bots);
    }
    this.sync(data.bots);
  }

  private buildStatic(): void {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(24.5, 0.3, 18.5),
      new THREE.MeshLambertMaterial({ map: woodTexture(), color: 0xffffff }),
    );
    floor.position.y = -0.15;
    this.scene.add(floor);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(24.9, 0.18, 18.9),
      new THREE.MeshLambertMaterial({ color: 0xc4a574 }),
    );
    plinth.position.y = -0.38;
    this.scene.add(plinth);

    this.addMeeting();
    this.addLounge();
  }

  private addMeeting(): void {
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(2.15, 28),
      new THREE.MeshLambertMaterial({ color: 0xf4efe6 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(MEETING.x, 0.02, MEETING.z);
    this.scene.add(rug);

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 0.1, 20),
      new THREE.MeshLambertMaterial({ color: 0x8d5a3c }),
    );
    top.position.set(MEETING.x, 0.74, MEETING.z);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.68, 8),
      new THREE.MeshLambertMaterial({ color: 0x5c3b2a }),
    );
    leg.position.set(MEETING.x, 0.34, MEETING.z);
    this.scene.add(top, leg);
    this.scene.add(flatLabel('Meet', '#8d5a3c', MEETING.x - 0.55, MEETING.z - 1.85, 1.3, 0.36));

    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      this.scene.add(chair(MEETING.x + Math.cos(a) * 1.85, MEETING.z + Math.sin(a) * 1.25, a + Math.PI));
    }
  }

  private addLounge(): void {
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 28),
      new THREE.MeshLambertMaterial({ color: 0xf6e7d4 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(LOUNGE.x, 0.02, LOUNGE.z);
    this.scene.add(rug);
    this.scene.add(flatLabel('Lounge', '#a56b3c', LOUNGE.x - 0.7, LOUNGE.z - 2.05, 1.6, 0.4));

    const sofa = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.38, 0.7),
      new THREE.MeshLambertMaterial({ color: 0x3b6cff }),
    );
    seat.position.y = 0.36;
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.55, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x2f4e9e }),
    );
    back.position.set(0, 0.62, -0.28);
    sofa.add(seat, back);
    sofa.position.set(LOUNGE.x, 0, LOUNGE.z + 1.35);
    this.scene.add(sofa);

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.08, 12),
      new THREE.MeshLambertMaterial({ color: 0xc4a574 }),
    );
    table.position.set(LOUNGE.x - 0.15, 0.42, LOUNGE.z + 0.15);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.36, 6),
      new THREE.MeshLambertMaterial({ color: 0x8d6a45 }),
    );
    stem.position.set(LOUNGE.x - 0.15, 0.2, LOUNGE.z + 0.15);
    this.scene.add(table, stem);
    this.scene.add(plant(LOUNGE.x + 1.7, LOUNGE.z + 1.15));
    this.scene.add(plant(-10.2, -6.4));
    this.scene.add(plant(10.4, 6.6));
  }

  private rebuild(bots: Bot[]): void {
    deskRegistry.clear();
    for (const child of [...this.dynamic.children]) {
      this.dynamic.remove(child);
      disposeObject(child);
    }
    this.hitTargets.length = 0;
    this.agents = [];

    const byZone = new Map<string, Bot[]>();
    for (const bot of bots) {
      const list = byZone.get(bot.zone) ?? [];
      list.push(bot);
      byZone.set(bot.zone, list);
    }

    const known = new Set(ZONE_LAYOUTS.map((zone) => zone.name));
    const orderedZones = [
      ...ZONE_LAYOUTS.map((zone) => zone.name),
      ...[...byZone.keys()].filter((name) => !known.has(name)),
    ];

    for (const zoneName of orderedZones) {
      const group = byZone.get(zoneName);
      if (!group || group.length === 0) continue;
      const layout = zoneLayout(zoneName);
      this.dynamic.add(rugFor(layout, group.length));
      group.forEach((bot, index) => {
        const globalIndex = bots.findIndex((item) => item.id === bot.id);
        this.dynamic.add(deskProps(slotPosition(layout, index), bot.id, bot.name));
        const agent = this.makeAgent(bot, layout, index, globalIndex, bots.length);
        this.agents.push(agent);
        this.dynamic.add(agent.root);
      });
    }
    this.refreshRings();
  }

  private makeAgent(bot: Bot, layout: ZoneLayout, index: number, globalIndex: number, total: number): Agent {
    const slot = slotPosition(layout, index);
    const seat = new THREE.Vector3(slot.x, 0, slot.z + 0.78);
    const stand = new THREE.Vector3(slot.x + 0.7, 0, slot.z + 0.9);
    const meeting = meetingPoint(globalIndex, total);
    const breaks = breakPoints(globalIndex);
    const shirt = SHIRTS[globalIndex % SHIRTS.length];

    const root = new THREE.Group();
    root.userData.botId = bot.id;
    root.position.set(seat.x, 0, seat.z);
    const pivot = new THREE.Group();
    root.add(pivot);

    const body = mesh(new THREE.BoxGeometry(0.42, 0.46, 0.24), shirt);
    body.position.y = 0.72;
    const head = mesh(new THREE.SphereGeometry(0.16, 10, 8), SKIN);
    head.position.y = 1.08;
    const hair = mesh(new THREE.SphereGeometry(0.165, 10, 8), HAIR);
    hair.position.y = 1.16;
    hair.scale.y = 0.55;
    const armL = mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), shirt);
    armL.geometry.translate(0, -0.16, 0);
    armL.position.set(-0.28, 0.86, 0);
    const armR = mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), shirt);
    armR.geometry.translate(0, -0.16, 0);
    armR.position.set(0.28, 0.86, 0);
    const legL = mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), PANTS);
    legL.geometry.translate(0, -0.17, 0);
    legL.position.set(-0.1, 0.46, 0);
    const legR = mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), PANTS);
    legR.geometry.translate(0, -0.17, 0);
    legR.position.set(0.1, 0.46, 0);
    const eyeL = mesh(new THREE.SphereGeometry(0.025, 6, 6), 0x1c1e27);
    eyeL.position.set(-0.06, 1.1, 0.13);
    const eyeR = mesh(new THREE.SphereGeometry(0.025, 6, 6), 0x1c1e27);
    eyeR.position.set(0.06, 1.1, 0.13);
    const parts = [body, head, hair, armL, armR, legL, legR, eyeL, eyeR];
    pivot.add(...parts);

    const alert = new THREE.Sprite(bangMaterial());
    alert.position.y = 1.48;
    alert.scale.set(0.46, 0.46, 1);
    alert.visible = false;
    root.add(alert);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: layout.color, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    root.add(ring);

    for (const part of parts) this.hitTargets.push(part);

    const deskBits = findDeskBits(bot.id);

    return {
      id: bot.id,
      root,
      pivot,
      parts,
      screen: deskBits.screen,
      lamp: deskBits.lamp,
      alert,
      ring,
      pos: seat.clone(),
      target: seat.clone(),
      seat,
      stand,
      meeting,
      breaks,
      breakIndex: 0,
      wander: 4 + (globalIndex % 3),
      phase: globalIndex * 0.7,
      name: bot.name,
      status: null,
      task: '',
      pose: 'seated',
      typing: false,
      greyed: false,
      monitorGlow: false,
      lampOn: true,
      alertOn: false,
      facing: Math.PI,
      zoneColor: layout.color,
    };
  }

  private sync(bots: Bot[]): void {
    const byId = new Map(bots.map((bot) => [bot.id, bot]));
    for (const agent of this.agents) {
      const bot = byId.get(agent.id);
      if (!bot) continue;
      if (agent.status === bot.status && agent.task === bot.task) continue;
      const behaviour = behaviourFor(bot.status, bot.task);
      agent.status = bot.status;
      agent.task = bot.task;
      agent.pose = behaviour.pose;
      agent.typing = behaviour.typing;
      agent.greyed = behaviour.greyed;
      agent.monitorGlow = behaviour.monitorGlow;
      agent.lampOn = behaviour.lampOn;
      agent.alertOn = behaviour.alert;
      agent.alert.visible = behaviour.alert;
      paintAgent(agent.parts, behaviour.greyed);
      const screenMat = agent.screen.material as THREE.MeshLambertMaterial;
      const lampMat = agent.lamp.material as THREE.MeshLambertMaterial;
      lampMat.emissive.set(behaviour.lampOn ? 0xffd7a1 : 0x000000);
      lampMat.emissiveIntensity = behaviour.lampOn ? 0.9 : 0;
      lampMat.color.set(behaviour.lampOn ? 0xffe1b5 : 0x6e675f);
      screenMat.color.set(behaviour.monitorGlow ? 0x9ec0ff : 0x242a38);
      screenMat.emissive.set(behaviour.monitorGlow ? 0x6ea2ff : 0x000000);
      if (behaviour.destination === 'break') agent.target.copy(agent.breaks[agent.breakIndex]);
      else if (behaviour.destination === 'meeting') agent.target.copy(agent.meeting);
      else if (behaviour.pose === 'standing') agent.target.copy(agent.stand);
      else agent.target.copy(agent.seat);
      if (this.reduceMotion) agent.pos.copy(agent.target);
    }
  }

  private tick(dt: number, time: number): void {
    for (const agent of this.agents) {
      const dx = agent.target.x - agent.pos.x;
      const dz = agent.target.z - agent.pos.z;
      const dist = Math.hypot(dx, dz);
      const moving = dist > 0.05;
      if (moving) {
        const step = Math.min(dist, 2.15 * dt);
        agent.pos.x += (dx / dist) * step;
        agent.pos.z += (dz / dist) * step;
        agent.facing = Math.atan2(dx, dz);
      } else if (agent.status === 'idle') {
        agent.wander -= dt;
        if (agent.wander <= 0) {
          agent.breakIndex = (agent.breakIndex + 1) % agent.breaks.length;
          agent.target.copy(agent.breaks[agent.breakIndex]);
          agent.wander = 5 + (agent.phase % 3);
        }
        agent.facing = Math.atan2(LOUNGE.x - agent.pos.x, LOUNGE.z - agent.pos.z);
      } else if (agent.pose === 'seated') {
        agent.facing = Math.PI;
      } else if (agent.status === 'working') {
        agent.facing = Math.atan2(MEETING.x - agent.pos.x, MEETING.z - agent.pos.z);
      } else {
        agent.facing = Math.PI;
      }

      agent.root.position.set(agent.pos.x, 0, agent.pos.z);
      agent.pivot.rotation.y = dampAngle(agent.pivot.rotation.y, agent.facing, this.reduceMotion ? 1 : dt * 8);

      const sit = !moving && agent.pose === 'seated' ? 0.4 : 0;
      agent.pivot.position.y = this.reduceMotion ? sit : damp(agent.pivot.position.y, sit, dt * 6);

      const armL = agent.parts[3];
      const armR = agent.parts[4];
      const legL = agent.parts[5];
      const legR = agent.parts[6];
      if (moving && !this.reduceMotion) {
        const swing = Math.sin(time * 9 + agent.phase) * 0.7;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.6;
        armR.rotation.x = swing * 0.6;
      } else if (agent.typing && !this.reduceMotion) {
        armL.rotation.x = -0.7 + Math.sin(time * 12 + agent.phase) * 0.35;
        armR.rotation.x = -0.7 + Math.sin(time * 12 + agent.phase + 1.4) * 0.35;
        legL.rotation.x = -1.15;
        legR.rotation.x = -1.15;
        agent.pivot.position.y = sit + Math.sin(time * 8 + agent.phase) * 0.012;
      } else if (!moving && agent.pose === 'seated') {
        armL.rotation.x = -0.35;
        armR.rotation.x = -0.35;
        legL.rotation.x = -1.15;
        legR.rotation.x = -1.15;
      } else {
        armL.rotation.x = 0;
        armR.rotation.x = 0;
        legL.rotation.x = 0;
        legR.rotation.x = 0;
      }

      if (agent.monitorGlow && !this.reduceMotion) {
        const mat = agent.screen.material as THREE.MeshLambertMaterial;
        mat.emissiveIntensity = 0.65 + Math.sin(time * 3 + agent.phase) * 0.25;
      } else {
        (agent.screen.material as THREE.MeshLambertMaterial).emissiveIntensity = agent.monitorGlow ? 0.7 : 0;
      }

      const active = agent.id === this.selected || agent.id === this.hovered;
      const ringMat = agent.ring.material as THREE.MeshBasicMaterial;
      const goal = agent.id === this.selected ? 0.95 : agent.id === this.hovered ? 0.55 : 0;
      ringMat.opacity = this.reduceMotion ? goal : damp(ringMat.opacity, goal, dt * 10);
      agent.ring.scale.setScalar(active ? 1.15 : 1);
    }

    if (this.label.visible) {
      const agent = this.agents.find((item) => item.id === (this.hovered ?? this.selected));
      if (agent) this.label.position.set(agent.pos.x, 1.72, agent.pos.z);
    }
  }

  private refreshRings(): void {
    for (const agent of this.agents) {
      const mat = agent.ring.material as THREE.MeshBasicMaterial;
      mat.color.set(agent.zoneColor);
    }
    this.refreshLabel();
  }

  private refreshLabel(): void {
    const id = this.hovered ?? this.selected;
    const agent = this.agents.find((item) => item.id === id);
    if (!agent) {
      this.label.visible = false;
      return;
    }
    this.label.visible = true;
    this.label.position.set(agent.pos.x, 1.78, agent.pos.z);
    if (this.labelText !== agent.name) {
      this.labelText = agent.name;
      const material = this.label.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.map = textTexture(agent.name);
      material.needsUpdate = true;
    }
  }

  private applyLight(mode: LightMode): void {
    if (mode === 'day') {
      this.hemi.color.set(0xfff6ea);
      this.hemi.groundColor.set(0xd9c3a5);
      this.hemi.intensity = 0.9;
      this.dir.color.set(0xfff4e2);
      this.dir.intensity = 1.15;
      this.amb.intensity = 0.38;
    } else if (mode === 'evening') {
      this.hemi.color.set(0xffc39a);
      this.hemi.groundColor.set(0x8a6a62);
      this.hemi.intensity = 0.48;
      this.dir.color.set(0xffb07a);
      this.dir.intensity = 0.62;
      this.amb.intensity = 0.18;
    } else {
      this.hemi.color.set(0x9bb4d6);
      this.hemi.groundColor.set(0x32384a);
      this.hemi.intensity = 0.18;
      this.dir.color.set(0xb7c6e6);
      this.dir.intensity = 0.22;
      this.amb.intensity = 0.08;
    }
  }

  private fit = (): void => {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const aspect = width / height;
    const halfH = aspect < 1 ? 12.5 : 8.6;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const id = this.pick(event);
    this.canvas.classList.toggle('pointing', Boolean(id));
    if (id === this.hovered) return;
    this.hovered = id;
    this.hooks.onHover(id);
    this.refreshLabel();
  };

  private onPointerLeave = (): void => {
    this.hovered = null;
    this.canvas.classList.remove('pointing');
    this.hooks.onHover(null);
    this.refreshLabel();
  };

  private onClick = (event: MouseEvent): void => {
    const id = this.pick(event);
    this.selected = id;
    this.hooks.onSelect(id);
    this.refreshRings();
  };

  private pick(event: { clientX: number; clientY: number }): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (typeof obj.userData.botId === 'string') return obj.userData.botId;
        obj = obj.parent;
      }
    }
    return null;
  }
}

const deskRegistry = new Map<string, { screen: THREE.Mesh; lamp: THREE.Mesh }>();

function findDeskBits(id: string): { screen: THREE.Mesh; lamp: THREE.Mesh } {
  const found = deskRegistry.get(id);
  if (!found) throw new Error(`Missing desk for ${id}`);
  return found;
}

function deskProps(slot: { x: number; z: number }, id: string, name: string): THREE.Group {
  const group = new THREE.Group();
  group.position.set(slot.x, 0, slot.z);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.08, 0.72),
    new THREE.MeshLambertMaterial({ color: 0xf7f4ef }),
  );
  top.position.y = 0.74;
  group.add(top);
  for (const [x, z] of [[-0.62, -0.26], [0.62, -0.26], [-0.62, 0.26], [0.62, 0.26]] as const) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.7, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xc4b09a }),
    );
    leg.position.set(x, 0.35, z);
    group.add(leg);
  }
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.4, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x2a303c }),
  );
  bezel.position.set(0, 1.02, -0.28);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.02),
    new THREE.MeshLambertMaterial({ color: 0x242a38, emissive: 0x000000 }),
  );
  screen.position.set(0, 1.02, -0.24);
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x3a4150 }),
  );
  neck.position.set(0, 0.84, -0.26);
  group.add(bezel, screen, neck);

  const lampPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.32, 6),
    new THREE.MeshLambertMaterial({ color: 0x4d453c }),
  );
  lampPole.position.set(0.52, 0.94, 0.12);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffe1b5, emissive: 0xffd7a1, emissiveIntensity: 0.8 }),
  );
  lamp.position.set(0.52, 1.12, 0.12);
  group.add(lampPole, lamp);

  group.add(chair(0, 0.78, Math.PI));
  group.add(namePlate(name));
  deskRegistry.set(id, { screen, lamp });
  return group;
}

function namePlate(name: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f4efe8';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#3a342c';
    ctx.font = '600 40px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, name, 480), 256, 50);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.18),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  plate.position.set(0, 0.79, 0.37);
  return plate;
}

function chair(x: number, z: number, rotation: number): THREE.Group {
  const group = new THREE.Group();
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.08, 0.46),
    new THREE.MeshLambertMaterial({ color: 0x4b5568 }),
  );
  seat.position.y = 0.46;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.36, 0.08),
    new THREE.MeshLambertMaterial({ color: 0x3d4656 }),
  );
  back.position.set(0, 0.66, -0.2);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x2c3142 }),
  );
  post.position.y = 0.22;
  group.add(seat, back, post);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function plant(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, 0.22, 8),
    new THREE.MeshLambertMaterial({ color: 0xc47b4a }),
  );
  pot.position.y = 0.12;
  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x2f9d6a }),
  );
  leaves.position.y = 0.42;
  group.add(pot, leaves);
  group.position.set(x, 0, z);
  return group;
}

function rugFor(layout: ZoneLayout, count: number): THREE.Group {
  const positions = Array.from({ length: count }, (_, index) => slotPosition(layout, index));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pos of positions) {
    minX = Math.min(minX, pos.x - 1.15);
    maxX = Math.max(maxX, pos.x + 1.15);
    minZ = Math.min(minZ, pos.z - 0.7);
    maxZ = Math.max(maxZ, pos.z + 1.35);
  }
  const w = maxX - minX;
  const d = maxZ - minZ;
  const group = new THREE.Group();
  const edge = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.18, d + 0.18),
    new THREE.MeshLambertMaterial({ color: layout.color }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.set((minX + maxX) / 2, 0.018, (minZ + maxZ) / 2);
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: layout.rug }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set((minX + maxX) / 2, 0.03, (minZ + maxZ) / 2);
  group.add(edge, fill);
  group.add(flatLabel(layout.name, layout.color, minX + 0.12, minZ + 0.02, Math.min(3.2, w * 0.8), 0.5, 'left'));
  return group;
}

function flatLabel(
  text: string,
  color: string,
  x: number,
  z: number,
  w: number,
  h: number,
  align: CanvasTextAlign = 'left',
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = color;
    ctx.font = '700 78px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    const px = align === 'left' ? 8 : 256;
    ctx.fillText(text, px, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x + (align === 'left' ? w / 2 : 0), 0.045, z + h / 2);
  return mesh;
}

function makeLabelSprite(text: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({ map: textTexture(text), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.5, 0.5, 1);
  return sprite;
}

function textTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(ctx, 8, 16, 496, 96, 28);
    ctx.fill();
    ctx.fillStyle = '#1c1e27';
    ctx.font = '600 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, text, 460), 256, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedBang: THREE.SpriteMaterial | null = null;
function bangMaterial(): THREE.SpriteMaterial {
  if (sharedBang) return sharedBang;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#c45a5a';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 84px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 64, 70);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedBang = new THREE.SpriteMaterial({ map: tex, depthTest: true });
  return sharedBang;
}

function mesh(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({ color });
  const item = new THREE.Mesh(geometry, material);
  item.userData.base = color;
  return item;
}

function paintAgent(parts: THREE.Mesh[], greyed: boolean): void {
  const grey = new THREE.Color('#b0b5c2');
  for (const part of parts) {
    const mat = part.material as THREE.MeshLambertMaterial;
    mat.color.set(part.userData.base as number);
    if (greyed) mat.color.lerp(grey, 0.78);
  }
}

function meetingPoint(index: number, total: number): THREE.Vector3 {
  const a = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(MEETING.x + Math.cos(a) * 1.65, 0, MEETING.z + Math.sin(a) * 1.12);
}

function breakPoints(index: number): THREE.Vector3[] {
  const spots: THREE.Vector3[] = [];
  for (let k = 0; k < 4; k += 1) {
    const a = ((index * 0.65 + k) / 4) * Math.PI * 2;
    spots.push(new THREE.Vector3(LOUNGE.x + Math.cos(a) * 1.35, 0, LOUNGE.z + Math.sin(a) * 0.95));
  }
  return spots;
}

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
      ctx.fillStyle = '#e6cba4';
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 8; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? '#e3c59a' : '#edd4b0';
        ctx.fillRect(0, i * 64, 512, 63);
        ctx.strokeStyle = 'rgba(140, 96, 48, 0.12)';
        ctx.beginPath();
        ctx.moveTo(0, i * 64 + 63.5);
        ctx.lineTo(512, i * 64 + 63.5);
        ctx.stroke();
      }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  let value = text;
  while (value.length > 1 && ctx.measureText(value).width > max) value = value.slice(0, -2);
  return value.length < text.length ? `${value.slice(0, -1)}…` : value;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function damp(current: number, target: number, lambda: number): number {
  return current + (target - current) * Math.min(1, lambda);
}

function dampAngle(current: number, target: number, lambda: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, lambda);
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const meshChild = child as THREE.Mesh;
    if (meshChild.geometry) meshChild.geometry.dispose();
    const material = meshChild.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else if (material && child.type !== 'Sprite') material.dispose();
  });
}
