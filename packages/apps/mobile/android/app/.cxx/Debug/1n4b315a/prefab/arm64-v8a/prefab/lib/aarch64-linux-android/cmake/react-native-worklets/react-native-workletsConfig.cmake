if(NOT TARGET react-native-worklets::worklets)
add_library(react-native-worklets::worklets SHARED IMPORTED)
set_target_properties(react-native-worklets::worklets PROPERTIES
    IMPORTED_LOCATION "/home/venky/growman/node_modules/.pnpm/react-native-worklets@0.7.4_@babel+core@7.29.0_react-native@0.83.2_@babel+core@7.29.0_@_d2c41d0c3b438a7b10c133da099130ad/node_modules/react-native-worklets/android/build/intermediates/cxx/Debug/733h233v/obj/arm64-v8a/libworklets.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/venky/growman/node_modules/.pnpm/react-native-worklets@0.7.4_@babel+core@7.29.0_react-native@0.83.2_@babel+core@7.29.0_@_d2c41d0c3b438a7b10c133da099130ad/node_modules/react-native-worklets/android/build/prefab-headers/worklets"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

