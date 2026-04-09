"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <>
      <section className="grid grid-cols-1 gap-2 overflow-hidden rounded-2xl md:grid-cols-4 md:grid-rows-2">
        <button
          type="button"
          onClick={() => setActiveIndex(0)}
          className="relative h-[320px] overflow-hidden text-left md:col-span-2 md:row-span-2 md:h-[520px]"
        >
          <Image src={mainImage} alt={title} fill className="object-cover" unoptimized />
        </button>
        {sideImages.map((item, index) => (
          <button
            key={`${item.url}-${index}`}
            type="button"
            onClick={() => setActiveIndex(index + 1)}
            className="relative h-[156px] overflow-hidden text-left md:h-[256px]"
          >
            <Image src={item.url} alt={item.category} fill className="object-cover" unoptimized />
            <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {item.category}
            </span>
          </button>
        ))}
      </section>

      {activeIndex !== null ? (
        <div className="fixed inset-0 z-[60] bg-black/90">
          <button
            type="button"
            onClick={() => setActiveIndex(null)}
            className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
            aria-label="關閉圖片預覽"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex h-full items-center justify-center p-4">
            <div className="relative h-[80vh] w-full max-w-6xl">
              <Image
                src={allImages[activeIndex].url}
                alt={allImages[activeIndex].category}
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
