import { audio } from '../audio/audio';
import type { GameSession } from '../app/game-session';
import { vibrate } from '../app/settings';
import type { PlayerStats } from '../game/types';
import { t } from '../i18n';
import { BoardView } from '../render/board-view';
import { paintEnemy, SunkClock } from '../render/scene';
import { C } from '../render/theme';
import { button, glitchTitle, h } from './dom';
import type { PhaseView } from './game-screen';

/** Ende: Sieg/Niederlage, Statistik, aufgedeckte Gegnerflotte, Fairness-Prüfung, Revanche. */
export class OverView implements PhaseView {
  el: HTMLElement;
  private board: BoardView;
  private fair = h('p', { class: 'fair' });
  private rematchBtn: HTMLButtonElement;
  private rematchNote = h('p', { class: 'note' });
  private stats = h('div', { class: 'stats' });
  private sunk = new SunkClock();

  constructor(
    private s: GameSession,
    leave: () => void,
  ) {
    const c = s.ctrl.core;
    const won = c.winner === s.ctrl.me;
    const sub = c.forfeitBy !== null ? (won ? t('over.forfeitWin') : t('over.forfeitLose')) : won ? t('over.winSub') : t('over.loseSub');
    const boardHost = h('div', { class: 'board-host' });
    this.rematchBtn = button(t('over.rematch'), () => s.ctrl.requestRematch(), 'primary');
    this.el = h(
      'div',
      { class: `over ${won ? 'won' : 'lost'}` },
      h('div', { class: 'over-head' }, glitchTitle(won ? t('over.win') : t('over.lose'), 'over-title'), h('p', { class: 'over-sub' }, sub)),
      h('div', { class: 'over-body' }, h('div', { class: 'board-frame over-board' }, boardHost, h('div', { class: 'board-tag enemy' }, t('over.enemyFleet'))), h('div', { class: 'panel stats-panel' }, h('h3', null, t('over.stats')), this.stats, this.fair)),
      h('div', { class: 'over-actions' }, this.rematchNote, this.rematchBtn, button(t('common.menu'), leave, 'ghost')),
    );
    this.board = new BoardView(boardHost, { labels: true });
    this.board.tint = C.pink;
    for (const sh of c.view.sunk) this.sunk.mark(sh, 0);
    this.board.painters.push((ctx, now) => {
      const core = this.s.ctrl.core;
      paintEnemy(ctx, now, { view: core.view, sunk: this.sunk, reveal: core.oppShips, revealMines: core.oppReveal?.layout.mines, round: core.match?.round ?? 0 });
    });
    audio.play(won ? 'win' : 'lose');
    vibrate(won ? [50, 50, 50, 50, 150] : [200, 100, 300]);
  }

  update() {
    const c = this.s.ctrl.core;
    const me = this.s.ctrl.me, opp = this.s.ctrl.opp;
    const m = c.match;
    const st: [PlayerStats, PlayerStats] | null = m ? m.stats : null;
    const acc = (p: PlayerStats) => (p.shots ? `${Math.round((p.hits / p.shots) * 100)} %` : '–');
    if (st) {
      const rows: [string, string, string][] = [
        [t('over.accuracy'), acc(st[me]), acc(st[opp])],
        [t('over.shots'), `${st[me].shots}`, `${st[opp].shots}`],
        [t('over.sunk'), `${st[me].sunk}`, `${st[opp].sunk}`],
      ];
      if (m!.mode === 'cyber') {
        rows.push([t('over.specials'), `${st[me].specials}`, `${st[opp].specials}`]);
        rows.push([t('over.mines'), `${st[me].minesHit}`, `${st[opp].minesHit}`]);
      }
      rows.push([t('over.rounds'), `${m!.round}`, '']);
      this.stats.replaceChildren(
        h('div', { class: 'stat-row head' }, h('span'), h('b', null, t('common.you')), h('b', null, c.oppName || t('common.opponent'))),
        ...rows.map(([l, a, b]) => h('div', { class: 'stat-row' }, h('span', null, l), h('b', null, a), h('b', null, b))),
      );
    }
    if (!c.verify) {
      this.fair.textContent = t('over.fairWait');
      this.fair.className = 'fair';
    } else if (c.verify.ok) {
      this.fair.textContent = t('over.fairOk');
      this.fair.className = 'fair ok';
    } else {
      this.fair.textContent = t('over.fairBad', { r: c.verify.reason ?? '?' });
      this.fair.className = 'fair bad';
    }
    this.rematchBtn.disabled = c.rematchMe || !!c.fatal;
    this.rematchBtn.textContent = c.rematchMe ? t('over.rematchWait') : t('over.rematch');
    this.rematchNote.textContent = c.rematchOpp && !c.rematchMe ? t('over.rematchOpp') : '';
  }

  destroy() {
    this.board.destroy();
  }
}
