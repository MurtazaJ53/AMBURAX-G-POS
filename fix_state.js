const fs = require("fs");
let content = fs.readFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", "utf-8");

const targetState = /const\s*\[method,\s*setMethod\]\s*=\s*useState<PaymentMethod>\("CASH"\);\s*const\s*\[reference,\s*setReference\]\s*=\s*useState\(""\);\s*const\s*\[amountReceived,\s*setAmountReceived\]\s*=\s*useState<number\s*\|\s*null>\(null\);/s;

const replaceState = `const [method, setMethod] = useState<PaymentMethod | "SPLIT">("CASH");
  const [reference, setReference] = useState("");
  const [amountReceived, setAmountReceived] = useState<number | null>(null);

  const [splitPayments, setSplitPayments] = useState<Array<{ id: string, method: PaymentMethod, amount: number | null, reference: string }>>([
    { id: "1", method: "CASH", amount: null, reference: "" },
    { id: "2", method: "UPI", amount: null, reference: "" }
  ]);`;
  
content = content.replace(targetState, replaceState);
fs.writeFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", content);
