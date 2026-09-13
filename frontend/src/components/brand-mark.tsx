type BrandMarkProps = {
  className?: string;
  variant?: "dark" | "light";
};

export function BrandMark({ className = "", variant = "dark" }: BrandMarkProps) {
  return (
    <img
      src="/brand/codestationai-mark.svg"
      alt=""
      aria-hidden="true"
      className={`${variant === "light" ? "invert" : ""} ${className}`.trim()}
    />
  );
}
