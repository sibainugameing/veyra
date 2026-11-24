import { Audio, Composition, Image, Marker, Sequence, Shape, Text, Track, Transition, Video, useFrame, useVideoConfig, interpolate, spring } from "@veyra/core";

function Title() {
  const f = useFrame();
  return <Text id="title" text="Welcome to Veyra" fontSize={80} y={20} opacity={interpolate(f, [0, 30], [0, 1])}
    editable={{ text: true, fontSize: true, color: true, y: true }} />;
}
function Bar() {
  const f = useFrame();
  return <Shape id="bar" x={40} y={500} width={interpolate(f, [0, 60], [0, 1200])} height={10} fill="#38bdf8"
    editable={{ y: true, height: true, fill: true }} />;
}
function Orb() {
  const f = useFrame(); const { fps } = useVideoConfig();
  return <Shape id="orb" kind="circle" x={spring({ frame: f, fps, from: 100, to: 1100, durationInFrames: 45 })} y={560} width={80} height={80} fill="#7c5cff"
    editable={{ y: true, width: true, height: true, fill: true }} />;
}
export default function Main() {
  return (
    <Composition id="main" width={1280} height={720} fps={30} durationInFrames={90}>
      <Track id="video" kind="video">
        <Sequence id="seq-clip" from={0} durationInFrames={60} editable={{ from: true, durationInFrames: true }}>
          <Video id="clip" src="assets/videos/clip.mp4" x={480} y={200} width={320} height={180} editable={{ x: true, y: true, width: true, height: true }} />
        </Sequence>
      </Track>
      <Track id="audio" kind="audio">
        <Sequence id="seq-music" from={30} durationInFrames={60} editable={{ from: true, durationInFrames: true }}>
          <Audio id="music" src="assets/audio/beep.wav" volume={0.8} editable={{ volume: true }} />
        </Sequence>
      </Track>
      <Track id="overlay" kind="overlay">
        <Sequence id="seq-title" from={0} durationInFrames={90} editable={{ from: true, durationInFrames: true }}><Title /><Bar /></Sequence>
        <Sequence id="seq-logo" from={30} durationInFrames={60} editable={{ from: true, durationInFrames: true }}>
          <Transition type="fade" inFrames={10} outFrames={10}>
            <Image id="logo" src="assets/images/logo.png" x={590} y={400} width={100} height={100} editable={{ x: true, y: true, width: true, height: true }} />
            <Orb />
            <Text id="subtitle" text="Code · GUI · AI" y={88} fontSize={36} color="#9fb3ff" editable={{ text: true, fontSize: true, color: true }} />
          </Transition>
        </Sequence>
        <Marker id="m-drop" frame={30} label="drop" />
      </Track>
    </Composition>
  );
}
