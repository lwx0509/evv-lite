import VideoTemplate from './components/video/VideoTemplate';
import { ExportOverlay } from './components/video/ExportOverlay';
import { CopyLinkButton } from './components/video/CopyLinkButton';

function App() {
  return (
    <div className="w-full h-screen bg-black text-white">
      <VideoTemplate />
      <div className="fixed top-4 right-4 z-[100] flex items-center gap-2">
        <CopyLinkButton />
        <ExportOverlay inline />
      </div>
    </div>
  );
}

export default App;
