import fs from 'fs';
let f = 'src/components/shell/AppHeader.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/{online \? 'Online' : 'Offline'}/, '{online ? "Store Online" : "Store Offline"}');

const tillOpenHtml = `{tillOpen && (
          <button type="button" className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] lg:flex">
            <Clock3 size={14} className="text-slate-400" />
            <span className="text-left">
              <b className="block font-semibold text-slate-700">Till Open</b>
              <small className="text-emerald-600 leading-none">Live</small>
            </span>
          </button>
        )}`;

c = c.replace(tillOpenHtml, '');

c = c.replace(/{canSell && \(/, `{tillOpen && (
          <button type="button" className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] lg:flex">
            <span className="text-left leading-tight">
              <b className="block font-bold text-slate-700">Shift #02</b>
              <small className="text-slate-400 font-semibold text-[9px] leading-none">Live</small>
            </span>
          </button>
        )}

        {canSell && (`);

c = c.replace(/<span className="hidden sm:inline">New sale<\/span>/, '<span className="hidden sm:inline">New Sale (F2)</span>');

c = c.replace(/{\/\* <i className="absolute right-1\.5 top-1\.5 size-1\.5 rounded-full bg-rose-500" \/> \*\/}/, 
`<i className="absolute right-[5px] top-[5px] flex size-3 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-[8px] font-bold text-white">1</i>`);

fs.writeFileSync(f, c);
