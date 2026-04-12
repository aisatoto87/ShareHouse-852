"use client";

import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** 對應 Radix `avoidCollisions={false}`：不因邊界翻轉／位移而帶動頁面捲動。 */
const MULTI_SELECT_POPOVER_COLLISION = {
  side: "none" as const,
  align: "none" as const,
  fallbackAxisSide: "none" as const,
};

export type TagInputFieldProps = {
  label: string;
  selectedItems: string[];
  query: string;
  setQuery: (value: string) => void;
  open: boolean;
  setOpen: (value: boolean) => void;
  filteredOptions: readonly string[];
  emptyText: string;
  placeholder: string;
  heading: string;
  onToggle: (value: string) => void;
  onRemove: (value: string) => void;
  onAddCustom: () => void;
  canAddCustom: boolean;
};

export function TagInputField({
  label,
  selectedItems,
  query,
  setQuery,
  open,
  setOpen,
  filteredOptions,
  emptyText,
  placeholder,
  heading,
  onToggle,
  onRemove,
  onAddCustom,
  canAddCustom,
}: TagInputFieldProps) {
  return (
    <div className="sm:col-span-2">
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      {selectedItems.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedItems.map((item) => (
            <Badge
              key={item}
              variant="secondary"
              className="gap-1 border border-[#1a3a5c]/15 bg-[#eef2ff] text-[#0f2540]"
            >
              {item}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-[#0f2540]/10"
                onClick={() => onRemove(item)}
                aria-label={`移除 ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mb-2 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              e.preventDefault();
              onAddCustom();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
          onClick={onAddCustom}
          disabled={!query.trim()}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          新增
        </Button>
      </div>

      <Popover modal={false} open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-900 outline-none transition-colors hover:border-[#1a3a5c]/40 focus-visible:border-[#0f2540] focus-visible:ring-2 focus-visible:ring-[#0f2540]/25"
          aria-label={`選擇${label}`}
          onPointerDown={(e) => e.preventDefault()}
        >
          <span className={selectedItems.length > 0 ? "text-zinc-900" : "text-zinc-500"}>
            {selectedItems.length > 0
              ? `已選 ${selectedItems.length} 項，點擊以編輯預設選項`
              : "參考常用選項（可直接輸入新增）"}
          </span>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[360px] p-0"
          positionMethod="fixed"
          collisionAvoidance={MULTI_SELECT_POPOVER_COLLISION}
          initialFocus={false}
          finalFocus={false}
        >
          <Command>
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup heading={heading}>
                {filteredOptions.map((option) => {
                  const checked = selectedItems.includes(option);
                  return (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => onToggle(option)}
                      className="justify-between"
                    >
                      <span>{option}</span>
                      <span className="flex items-center gap-2">
                        <Checkbox checked={checked} />
                        {checked ? <Check className="h-4 w-4 text-[#0f2540]" /> : null}
                      </span>
                    </CommandItem>
                  );
                })}
                {canAddCustom ? (
                  <CommandItem value={`add-${query}`} onSelect={onAddCustom} className="text-[#0f2540]">
                    新增「{query.trim()}」
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
