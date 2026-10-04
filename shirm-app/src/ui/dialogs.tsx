// Модальные окна вместо alert/prompt/confirm.
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Req =
  | { kind: 'confirm'; title: string; text?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;

export function confirmDialog(title: string, text?: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => push ? push({ kind: 'confirm', title, text, danger, resolve }) : resolve(window.confirm(title)));
}
export function promptDialog(title: string, value = '', placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => push ? push({ kind: 'prompt', title, value, placeholder, resolve }) : resolve(window.prompt(title, value)));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { push = (r) => { setReq(r); if (r.kind === 'prompt') setVal(r.value); }; return () => { push = null; }; }, []);
  useEffect(() => { if (req?.kind === 'prompt') setTimeout(() => input.current?.select(), 0); }, [req]);
  if (!req) return null;
  const close = (v: any) => { req.resolve(v); setReq(null); };
  return (
    <Modal title={req.title} onClose={() => close(req.kind === 'confirm' ? false : null)} width={460}>
      {req.kind === 'confirm' ? (
        <>
          {req.text && <p className="dlg-text">{req.text}</p>}
          <div className="dlg-actions">
            <button className="btn" onClick={() => close(false)}>Отмена</button>
            <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>Да</button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); close(val); }}>
          <input ref={input} className="input" value={val} placeholder={req.placeholder} onChange={(e) => setVal(e.target.value)} />
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={() => close(null)}>Отмена</button>
            <button type="submit" className="btn btn-primary">ОК</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Modal({ title, onClose, children, width = 900, footer }: {
  title: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
