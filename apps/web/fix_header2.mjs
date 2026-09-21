import fs from 'fs';
let f = 'src/components/shell/AppHeader.tsx';
let c = fs.readFileSync(f, 'utf8');

const shiftBlock = `{tillOpen && (
          <button type="button" className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] lg:flex">
            <span className="text-left leading-tight">
              <b className="block font-bold text-slate-700">Shift #02</b>
              <small className="text-slate-400 font-semibold text-[9px] leading-none">Live</small>
            </span>
          </button>
        )}`;

const newShiftBlock = `<button type="button" className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] lg:flex">
          <span className="text-left leading-tight">
            <b className="block font-bold text-slate-700">{tillOpen ? 'Shift #02' : 'Shift'}</b>
            <small className="text-slate-400 font-semibold text-[9px] leading-none">{tillOpen ? 'Live' : 'No shift'}</small>
          </span>
        </button>`;

c = c.replace(shiftBlock, newShiftBlock);
fs.writeFileSync(f, c);
