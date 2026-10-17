import { version } from "../package.json";

// 限定版本文件名，避免版本号被解释为路径；支持预发布和构建标记。
export const SDK_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!SDK_VERSION_PATTERN.test(version)) throw new Error("package.json 中的版本号无效");

export const VERSION = version;
export const SDK_PATH = `/mazda@${VERSION}`;
