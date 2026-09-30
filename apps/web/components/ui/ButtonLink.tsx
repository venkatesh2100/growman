import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClass, type ButtonSize, type ButtonTone } from "./buttonStyles";

type ButtonLinkProps = ComponentProps<typeof Link> & {
  tone?: ButtonTone;
  size?: ButtonSize;
};

/** A `next/link` styled as a button, for navigation that reads as an action. */
export default function ButtonLink({
  tone = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClass(tone, size, className)} {...props} />;
}
