# cryojs

Node.js tooling library for Cryo Engine - `.cryo` file parsing, validation, and compilation to cryo-protocol.

## Installation

```bash
npm install @cryo/cryojs
```

## Usage

### Library API

```typescript
import { parse, compile, serialize, parseFile, compileFile } from '@cryo/cryojs';

// Parse .cryo XML string
const result = parse(xmlString);

// Compile to protocol format
const compiled = compile(result.document);
const json = serialize(compiled, 'json');
const pbtxt = serialize(compiled, 'pbtxt');
```

### CLI

```bash
cryojs parse scene.cryo
cryojs compile scene.cryo -o scene.json
cryojs validate "scenes/*.cryo"
cryojs info scene.cryo
```

## .cryo File Format

XML-based DSL for defining scenes and entities with embedded Lua scripts.
See [cryo-specification](../cryo-specification/cryo-file-format/) for the complete specification.

## Protocol Mapping

Compiled output maps to cryo-protocol protobuf messages:

- `<entity>` -> `chevp.cryo.entity.Entity`
- `<transform>` -> `chevp.cryo.common.CryoTransform`
- Components -> `chevp.cryo.entity.*Component`

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
