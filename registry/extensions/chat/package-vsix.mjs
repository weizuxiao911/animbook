#!/usr/bin/env node
/**
 * package-vsix.mjs — 打包成标准 VS Code .vsix
 *
 * .vsix = zip, 标准结构:
 *   [Content_Types].xml
 *   extension.vsixmanifest
 *   extension/package.json
 *   extension/out/extension.js
 *
 * 输出: ../../vsix/webapp-test.chat-0.1.0.vsix
 *
 * 入口路径固定为 out/extension.js (vsix 内文件实际位置),
 * 不能沿用源码包的 dist/extension.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = path.resolve(__dirname, '..', '..');
const VSIX_DIR = path.join(REGISTRY_ROOT, 'vsix');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const { name, version, publisher, description, engines, activationEvents, sumiContributes } = pkg;
const id = `${publisher}.${name}-${version}`;

fs.mkdirSync(VSIX_DIR, { recursive: true });

// 读构建产物 extension.js
const extensionJs = fs.readFileSync(path.resolve(__dirname, 'dist', 'extension.js'));

// vsix 内的 package.json (去掉 scripts, 加 engines.vscode)
const vsixPkg = {
  name,
  displayName: pkg.displayName ?? name,
  description,
  version,
  publisher,
  main: 'out/extension.js',
  engines,
  activationEvents,
  sumiContributes,
};
const vsixPkgJson = JSON.stringify(vsixPkg, null, 2);

// 标准 vsix 清单
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${name}" Version="${version}" Publisher="${publisher}" />
    <DisplayName>${pkg.displayName ?? name}</DisplayName>
    <Description xml:space="preserve">${description ?? ''}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
  </Assets>
</PackageManifest>
`;

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="text/javascript" />
</Types>
`;

const zip = new AdmZip();
zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));
zip.addFile('extension.vsixmanifest', Buffer.from(vsixManifest, 'utf-8'));
zip.addFile('extension/package.json', Buffer.from(vsixPkgJson, 'utf-8'));
zip.addFile('extension/out/extension.js', extensionJs);

const outFile = path.join(VSIX_DIR, `${id}.vsix`);
zip.writeZip(outFile);
console.log(`[package] wrote: ${path.relative(REGISTRY_ROOT, outFile)} (${(extensionJs.length / 1024).toFixed(1)}KB)`);
