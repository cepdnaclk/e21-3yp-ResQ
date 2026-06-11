cmake_minimum_required(VERSION 3.16)

# On Windows, when using the cross-toolchain the default C/C++ standard
# libraries detected by CMake may contain MSVC import libs (kernel32.lib,
# user32.lib, ...). The riscv32-esp-elf linker doesn't use those and will
# fail if the Windows SDK is not installed. Clear these variables to avoid
# pulling MSVC import libs into the cross-linker.
if(WIN32)
	set(CMAKE_C_STANDARD_LIBRARIES "")
	set(CMAKE_CXX_STANDARD_LIBRARIES "")
endif()

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(resq-firmware)