"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type GalleryItem = { category: string; url: string };

interface PropertyBentoGalleryProps {
  title: string;
  mainImage: string;
  sideImages: GalleryItem[];
}

export default function PropertyBentoGallery({
  title,
  mainImage,
  sideImages,
}: PropertyBentoGalleryProps) {
  const allImages = useMemo(
    () => [{ category: "主圖", url: mainImage }, ...sideImages],
    [mainImage, sideImages]
  );
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);

  const isFirstImage = currentIndex === 0;
  const isLastImage = currentIndex === allImages.length - 1;

  useEffect(() => {
    if (currentIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCurrentIndex(null);
      } else if (event.key === "ArrowLeft") {
        setCurrentIndex((prev) => {
          if (prev === null || prev <= 0) return prev;
          return prev - 1;
        });
      } else if (event.key === "ArrowRight") {
        setCurrentIndex((prev) => {
          if (prev === null || prev >= allImages.length - 1) return prev;
          return prev + 1;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allImages.length, currentIndex]);

  return (
    <>
      <section className="grid grid-cols-1 gap-2 overflow-hidden rounded-2xl md:grid-cols-4 md:grid-rows-2">
        <button
          type="button"
          onClick={() => setCurrentIndex(0)}
          className="relative h-[320px] overflow-hidden text-left md:col-span-2 md:row-span-2 md:h-[520px]"
        >
          <Image src={mainImage} alt={title} fill className="object-cover" unoptimized />
        </button>
        {sideImages.map((item, index) => (
          <button
            key={`${item.url}-${index}`}
            type="button"
            onClick={() => setCurrentIndex(index + 1)}
            className="relative h-[156px] overflow-hidden text-left md:h-[256px]"
          >
            <Image src={item.url} alt={item.category} fill className="object-cover" unoptimized />
            <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {item.category}
            </span>
          </button>
        ))}
      </section>

      {currentIndex !== null ? (
        <div className="fixed inset-0 z-[60] bg-black/90">
          <button
            type="button"
            onClick={() => setCurrentIndex(null)}
            className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
            aria-label="關閉圖片預覽"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((prev) => {
                if (prev === null || prev <= 0) return prev;
                return prev - 1;
              })
            }
            disabled={isFirstImage}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-0 md:left-5"
            aria-label="查看上一張圖片"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((prev) => {
                if (prev === null || prev >= allImages.length - 1) return prev;
                return prev + 1;
              })
            }
            disabled={isLastImage}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-0 md:right-5"
            aria-label="查看下一張圖片"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="flex h-full items-center justify-center p-4">
            <div className="relative h-[80vh] w-full max-w-6xl">
              <Image
                src={allImages[currentIndex].url}
                alt={allImages[currentIndex].category}
                fill
                className="object-contain"
                unoptimized
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
