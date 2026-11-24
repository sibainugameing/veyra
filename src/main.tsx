import { Audio, Image, Sequence, Shape, Text, Video, useFrame, interpolate } from "@veyra/core";
function Title() {
  const f = useFrame();
  return <Text id="title" text="Welcome to Veyra" fontSize={80} opacity={interpolate(f, [0, 30], [0, 1])} y={20} />;
}
export default function Main() {
  const f = useFrame();
  return (
    <>
      <Sequence from={0} durationInFrames={90}>
        <Title />
        <Shape x={40} y={500} width={interpolate(f, [0, 60], [0, 1200])} height={10} fill="#38bdf8" />
      </Sequence>
      <Sequence from={0} durationInFrames={60}>
        <Video src="assets/videos/clip.mp4" x={480} y={200} width={320} height={180} />
      </Sequence>
      <Sequence from={30} durationInFrames={60}>
        <Audio src="assets/audio/beep.wav" volume={0.8} />
        <Image src="assets/images/logo.png" x={590} y={400} width={100} height={100} />
        <Shape kind="circle" x={1100} y={560} width={80} height={80} fill="#7c5cff" />
        <Text text="Code · GUI · AI" y={88} fontSize={36} color="#9fb3ff" />
      </Sequence>
    </>
  );
}
