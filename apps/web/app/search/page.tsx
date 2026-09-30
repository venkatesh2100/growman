import { Suspense } from "react"
import type { Metadata } from "next"
import Searchcomponent from "./searchComponent"

/**
 * Internal search results are noindex: `?q=` combinations would otherwise
 * generate an unbounded number of thin, near-duplicate URLs. `follow` is kept
 * so crawlers still traverse to the real product pages from here.
 */
export const metadata: Metadata = {
  title: "Search Plants",
  description: "Search the Growman plant catalog.",
  robots: { index: false, follow: true },
}

export default function SearchPage(){
  return(
    <main>
      <Suspense fallback={<div className="mx-auto min-h-[50vh] max-w-7xl px-4 pt-8 sm:px-6 lg:px-8" aria-busy="true" />}>
        <Searchcomponent/>
      </Suspense>
    </main>
  )
}
