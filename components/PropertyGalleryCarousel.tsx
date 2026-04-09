"use client";

import Image from "next/image";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

interface PropertyGalleryCarouselProps {
  gallery: string[];
  title: string;
}

export default function PropertyGalleryCarousel({ gallery, title }: PropertyGalleryCarouselProps) {
  if (gallery.length === 0) {
    return (
      <div
        className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border border-dashed border-[#1a3a5c]/45 bg-[#0f2540]/5 text-center text-sm text-[#1a3a5c]"
        role="status"
      >
        此單位暫未有相簿圖片
      </div>
    );
  }

  return (
    <div className="relative px-11 sm:px-12">
      <Carousel
        className="w-full"
        opts={{
          align: "start",
          loop: gallery.length > 1,
        }}
      >
        <CarouselContent>
          {gallery.map((src, index) => (
            <CarouselItem key={`${src}-${index}`}>
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[#1a3a5c]/40 bg-[#0a1628] shadow-lg">
                <Image
                  src={src}
                  alt={`${title} — 相片 ${index + 1}`}
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 100vw, 72rem"
                  className="object-cover"
                  priority={index === 0}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f2540]/40 to-transparent" />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        {gallery.length > 1 && (
          <>
            <CarouselPrevious className="left-1 border-[#1a3a5c]/35 bg-white/95 text-[#0f2540] shadow-md hover:bg-white disabled:opacity-40" />
            <CarouselNext className="right-1 border-[#1a3a5c]/35 bg-white/95 text-[#0f2540] shadow-md hover:bg-white disabled:opacity-40" />
          </>
        )}
      </Carousel>
    </div>
  );
}
