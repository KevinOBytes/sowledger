import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "SOWLedger — time tracking and invoicing for client work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A build-time brand image: no params, request URLs, or customer data are read.
export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public/logo.png"));
  const logoSource = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#f7f2ea", padding: "60px 72px", color: "#0f172a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* The image renderer uses this local, fixed data URL rather than next/image. */}
        <img src={logoSource} width={72} height={72} alt="" style={{ borderRadius: 18 }} />
        <span style={{ fontSize: 42, fontWeight: 700 }}>SOWLedger</span>
      </div>
      <div style={{ display: "flex", marginTop: 54, fontSize: 72, fontWeight: 700, letterSpacing: -3, lineHeight: 1.08, maxWidth: 980 }}>
        Your work, your time, your invoices. Together.
      </div>
      <div style={{ display: "flex", marginTop: 32, fontSize: 30, color: "#475569" }}>
        Time tracking and invoicing for client work.
      </div>
      <div style={{ display: "flex", marginTop: "auto", paddingTop: 26, borderTop: "2px solid #e4dbcf", fontSize: 24, color: "#155e75" }}>
        Plan · Track · Review · Invoice
      </div>
    </div>,
    size,
  );
}
