import {
  DEFAULT_TMUX_SESSION,
  tmuxCommand,
  tmuxSessionName,
} from '../src/store/models';

describe('tmux', () => {
  it('usa el nombre por defecto si no hay uno', () => {
    expect(tmuxSessionName({})).toBe(DEFAULT_TMUX_SESSION);
    expect(tmuxSessionName({ tmuxSession: '   ' })).toBe(DEFAULT_TMUX_SESSION);
  });

  it('quita lo que la shell podría interpretar', () => {
    expect(tmuxSessionName({ tmuxSession: 'dev; rm -rf /' })).toBe('devrm-rf');
    expect(tmuxSessionName({ tmuxSession: '$(id)`x`' })).toBe('idx');
    expect(tmuxSessionName({ tmuxSession: 'proyecto_1.2-b' })).toBe(
      'proyecto_1.2-b',
    );
  });

  it('crea o se reengancha a la sesión y termina con Enter', () => {
    const cmd = tmuxCommand({ tmuxSession: 'devin' });
    expect(cmd.startsWith(' ')).toBe(true); // fuera del historial
    expect(cmd).toContain(
      String.raw`exec tmux new-session -A -s devin \; set-option mouse on \; set-option -wq window-size latest`,
    );
    expect(cmd.endsWith('\r')).toBe(true);
  });
});
