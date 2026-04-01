'use client';
import Lottie from "lottie-react";
import loadingAnimation from "../public/Girl.json";

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center  px-4">
      <div className="text-center">
        {/* Responsive container for the animation */}
        <div className="mx-auto w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 lg:w-120 lg:h-120">
          <Lottie
            animationData={loadingAnimation}
            loop
            className="w-full h-full bg-transparent"
          />
        </div>

        {/* Optional loading text */}
        {/* <p className="text-green-800 font-medium mt-4 text-sm sm:text-base md:text-lg">
          Loading...
        </p> */}
      </div>
    </div>
  );
}
