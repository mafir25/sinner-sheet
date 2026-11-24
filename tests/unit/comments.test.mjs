import { describe, it, expect, beforeEach } from 'vitest';
import { NodeSchema, emptyNode } from '../../shirm-app/src/model/schema.ts';
import { Physics } from '../../shirm-app/src/board/physics.ts';

describe('Комментарии и нефизические ноды', () => {
  describe('Модель узла (NodeSchema & emptyNode)', () => {
    it('emptyNode создает стандартный узел с физикой по умолчанию', () => {
      const n = emptyNode(100, 200);
      expect(n.kind).toBe('node');
      expect(n.isComment).toBe(false);
      expect(n.noPhysics).toBe(false);
      expect(n.shape).toBe('circle');
    });

    it('emptyNode(x, y, true) создает нефизический узел-комментарий', () => {
      const n = emptyNode(150, 250, true);
      expect(n.kind).toBe('node');
      expect(n.isComment).toBe(true);
      expect(n.noPhysics).toBe(true);
      expect(n.shape).toBe('comment');
      expect(n.title).toBe('Комментарий');
    });

    it('NodeSchema валидирует комментарий и нефизический флаг', () => {
      const parsed = NodeSchema.safeParse({
        kind: 'node',
        id: 'test_node_1',
        title: 'Заметка о встрече',
        shape: 'comment',
        color: '#F1C40F',
        size: 1.5,
        x: 50,
        y: 60,
        isComment: true,
        noPhysics: true,
        authorNick: 'Dante',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.isComment).toBe(true);
        expect(parsed.data.noPhysics).toBe(true);
        expect(parsed.data.authorNick).toBe('Dante');
      }
    });
  });

  describe('Физика доски (Physics)', () => {
    it('нефизические узлы и комментарии исключаются из симуляции', () => {
      const rendered = [];
      const ph = new Physics((nodes) => {
        rendered.push([...nodes.keys()]);
      });

      const items = {
        n1: { ...emptyNode(0, 0), id: 'n1', title: 'Обычный узел 1' },
        n2: { ...emptyNode(100, 100), id: 'n2', title: 'Обычный узел 2' },
        c1: { ...emptyNode(50, 50, true), id: 'c1', title: 'Комментарий 1', isComment: true, noPhysics: true },
        c2: { ...emptyNode(80, 80), id: 'c2', title: 'Без физики', noPhysics: true },
      };

      ph.sync(items, () => 20, false);

      // Внутренний Map nodes должен содержать только n1 и n2
      const simNodes = ph['nodes'];
      expect(simNodes.has('n1')).toBe(true);
      expect(simNodes.has('n2')).toBe(true);
      expect(simNodes.has('c1')).toBe(false);
      expect(simNodes.has('c2')).toBe(false);
    });
  });
});
