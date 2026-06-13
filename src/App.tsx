import VideoTemplate from './components/video/VideoTemplate';
import { ExportOverlay } from './components/video/ExportOverlay';

function App() {
  return (
    <div className="w-full h-screen bg-black text-white">
      <VideoTemplate />
      <ExportOverlay />
    </div>
  );
}

export default App;
