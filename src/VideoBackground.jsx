import { useEffect, useRef, useState } from "react";

const videos = [
  "/1.mp4",
  "/2.mp4",
  "/3.mp4",
  "/4.mp4",
  "/5.mp4",
  "/6.mp4",
];

function getInitialIndex() {
  if (videos.length <= 1) return 0;

  const lastIndex = Number(localStorage.getItem("lastVideoIndex"));
  let newIndex = Math.floor(Math.random() * videos.length);

  while (videos.length > 1 && newIndex === lastIndex) {
    newIndex = Math.floor(Math.random() * videos.length);
  }

  localStorage.setItem("lastVideoIndex", String(newIndex));
  return newIndex;
}

function getNextIndex(index) {
  return (index + 1) % videos.length;
}

export default function VideoBackground() {
  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const preloadTimerRef = useRef(null);

  const [currentIndex, setCurrentIndex] = useState(() => getInitialIndex());
  const [activeLayer, setActiveLayer] = useState("A");

  const setVideoSource = (videoEl, index) => {
    if (!videoEl) return;

    videoEl.pause();
    videoEl.src = videos[index];
    videoEl.dataset.index = String(index);
    videoEl.load();
    videoEl.currentTime = 0;
  };

  useEffect(() => {
    const firstVideo = videoARef.current;
    const secondVideo = videoBRef.current;

    if (!firstVideo || !secondVideo) return;

    setVideoSource(firstVideo, currentIndex);
    firstVideo.play().catch(() => {});

    setVideoSource(secondVideo, getNextIndex(currentIndex));

    return () => {
      clearTimeout(preloadTimerRef.current);
      firstVideo.pause();
      secondVideo.pause();
    };
  }, []);

  const handleVideoEnd = async () => {
    clearTimeout(preloadTimerRef.current);

    const nextIndex = getNextIndex(currentIndex);
    const preloadAfterNextIndex = getNextIndex(nextIndex);

    const currentVideo =
      activeLayer === "A" ? videoARef.current : videoBRef.current;
    const nextVideo =
      activeLayer === "A" ? videoBRef.current : videoARef.current;

    if (!currentVideo || !nextVideo) return;

    if (Number(nextVideo.dataset.index) !== nextIndex) {
      setVideoSource(nextVideo, nextIndex);
    }

    nextVideo.currentTime = 0;

    try {
      await nextVideo.play();
    } catch {
      return;
    }

    setActiveLayer((prev) => (prev === "A" ? "B" : "A"));
    setCurrentIndex(nextIndex);

    preloadTimerRef.current = setTimeout(() => {
      setVideoSource(currentVideo, preloadAfterNextIndex);
    }, 700);
  };

  return (
    <div className="video-background" aria-hidden="true">
      <video
        ref={videoARef}
        className={`video-layer ${activeLayer === "A" ? "active" : "inactive"}`}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={handleVideoEnd}
      />
      <video
        ref={videoBRef}
        className={`video-layer ${activeLayer === "B" ? "active" : "inactive"}`}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={handleVideoEnd}
      />
    </div>
  );
}