import { PdfLayerViewer } from "./pdf-layer-viewer";

export const metadata = { title: "PDF" };

export default function PdfPage() {
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <PdfLayerViewer />
    </div>
  );
}
