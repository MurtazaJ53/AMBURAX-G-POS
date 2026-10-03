const fs = require("fs");
let content = fs.readFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", "utf-8");

content = content.replace(/const PAYMENT_METHODS = \[\s*\{ value: "CASH", label: "Cash" \},\s*\{ value: "UPI", label: "UPI" \},\s*\{ value: "CARD", label: "Card" \},\s*\{ value: "SPLIT", label: "Split" \},\s*\] as const;/gs, `const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "SPLIT", label: "Split" },
  { value: "MORE", label: "More" },
];`);

content = content.replace(/const \[method, setMethod\] = useState<PaymentMethod \| "SPLIT">\("CASH"\);/g, `const [method, setMethod] = useState<PaymentMethod>("CASH");`);

content = content.replace(/setMethod\(m\.value as PaymentMethod \| "SPLIT"\);/g, `setMethod(m.value);`);

fs.writeFileSync("apps/web/src/app/(app)/pos/PosTerminal.tsx", content);
