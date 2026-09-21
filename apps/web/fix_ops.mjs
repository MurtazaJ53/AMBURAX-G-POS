import fs from 'fs';
let f = 'src/components/dashboard/OperationsCards.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/<th>Available<\/th>/, '<th>Stock</th>');
c = c.replace(/<th>Status<\/th>/, '<th>Reorder</th>');

const oldStockRow = `                    <td className="data-mono font-bold text-slate-700">{row.quantity}</td>
                    <td>
                      <span className={\`status-badge \${status === 'Critical' ? 'status-critical' : 'status-low'}\`}>
                        {status}
                      </span>
                    </td>`;

const newStockRow = `                    <td className={\`data-mono font-bold \${row.quantity <= 5 ? 'text-rose-600' : 'text-slate-700'}\`}>{row.quantity}</td>
                    <td className="data-mono text-slate-500">20</td>`;

c = c.replace(oldStockRow, newStockRow);

const oldSaleStatus = `{sale.erpSyncStatus === "SYNCED" ? (
                      <span className="status-badge status-paid">Posted</span>
                    ) : (
                      <span className="status-badge status-pending">Not posted</span>
                    )}`;

const newSaleStatus = `{sale.completedAt ? (
                      <span className="status-badge status-paid uppercase bg-emerald-50 text-emerald-600 border border-emerald-200">Paid</span>
                    ) : (
                      <span className="status-badge status-pending uppercase">Pending</span>
                    )}`;

c = c.replace(oldSaleStatus, newSaleStatus);

fs.writeFileSync(f, c);
