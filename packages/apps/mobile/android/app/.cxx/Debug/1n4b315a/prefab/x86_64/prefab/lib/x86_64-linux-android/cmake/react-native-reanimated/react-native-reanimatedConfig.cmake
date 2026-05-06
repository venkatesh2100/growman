if(NOT TARGET react-native-reanimated::reanimated)
add_library(react-native-reanimated::reanimated SHARED IMPORTED)
set_target_properties(react-native-reanimated::reanimated PROPERTIES
    IMPORTED_LOCATION "/home/venky/growman/node_modules/.pnpm/react-native-reanimated@4.2.1_react-native-worklets@0.7.4_@babel+core@7.29.0_react-nati_cc2687fbb6f670fb5b98dc3700eefc26/node_modules/react-native-reanimated/android/build/intermediates/cxx/Debug/p1o3g492/obj/x86_64/libreanimated.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/venky/growman/node_modules/.pnpm/react-native-reanimated@4.2.1_react-native-worklets@0.7.4_@babel+core@7.29.0_react-nati_cc2687fbb6f670fb5b98dc3700eefc26/node_modules/react-native-reanimated/android/build/prefab-headers/reanimated"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

