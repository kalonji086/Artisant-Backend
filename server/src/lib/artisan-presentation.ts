import AdmZip from 'adm-zip';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import PptxGenJS from 'pptxgenjs';

const MAX_ARCHIVE_ENTRIES = 600;
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_SLIDES = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

export type ImportedSlideImage = {
  data: Buffer;
  extension: 'jpg' | 'png';
  caption: string;
};

const readXml = (entries: Map<string, AdmZip.IZipEntry>, name: string) => {
  const entry = entries.get(name);
  if (!entry || entry.header.size > 2 * 1024 * 1024) {
    throw new Error('Le fichier PowerPoint est incomplet ou invalide.');
  }
  return entry.getData().toString('utf8');
};

const collectSlideContent = (value: unknown, texts: string[], imageIds: string[]) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSlideContent(item, texts, imageIds));
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, nested] of Object.entries(value)) {
    if (key === 'a:t') {
      if (typeof nested === 'string') texts.push(nested);
      else if (typeof nested === 'object' && nested !== null) {
        const textNode = (nested as Record<string, unknown>)['#text'];
        if (typeof textNode === 'string') texts.push(textNode);
      }
    }
    if (key === 'a:blip' && typeof nested === 'object' && nested !== null) {
      const relationId = (nested as Record<string, unknown>)['@_r:embed'];
      if (typeof relationId === 'string') imageIds.push(relationId);
    }
    collectSlideContent(nested, texts, imageIds);
  }
};

const parseRelationships = (xml: string) => {
  const parsed = xmlParser.parse(xml) as {
    Relationships?: { Relationship?: Record<string, unknown> | Record<string, unknown>[] };
  };
  const relationships = parsed.Relationships?.Relationship;
  const list = Array.isArray(relationships) ? relationships : relationships ? [relationships] : [];
  return new Map(
    list.flatMap((relation) => {
      const id = relation['@_Id'];
      const target = relation['@_Target'];
      if (typeof id !== 'string' || typeof target !== 'string') return [];
      return [[id, target] as const];
    }),
  );
};

const imageFormat = (data: Buffer): ImportedSlideImage['extension'] | null => {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  return null;
};

export const extractPresentationImages = (buffer: Buffer): ImportedSlideImage[] => {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error('Le fichier sélectionné n’est pas un PowerPoint valide.');
  }

  const zip = new AdmZip(buffer, { readEntries: true });
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('Le PowerPoint contient trop de fichiers.');
  }
  if (entries.reduce((total, entry) => total + entry.header.size, 0) > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('Le PowerPoint est trop volumineux une fois décompressé.');
  }

  const entryMap = new Map(entries.map((entry) => [entry.entryName, entry]));
  if (!entryMap.has('[Content_Types].xml') || !entryMap.has('ppt/presentation.xml')) {
    throw new Error('Le fichier sélectionné n’est pas un PowerPoint valide.');
  }

  const slideNames = entries
    .map((entry) => entry.entryName)
    .map((name) => ({ name, match: /^ppt\/slides\/slide(\d+)\.xml$/.exec(name) }))
    .filter((item): item is { name: string; match: RegExpExecArray } => !!item.match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  if (slideNames.length === 0 || slideNames.length > MAX_SLIDES) {
    throw new Error(`Le PowerPoint doit contenir entre 1 et ${MAX_SLIDES} diapositives.`);
  }

  const slides: ImportedSlideImage[] = [];
  let totalImageBytes = 0;

  for (const { name, match } of slideNames) {
    const slideContent = xmlParser.parse(readXml(entryMap, name));
    const texts: string[] = [];
    const imageIds: string[] = [];
    collectSlideContent(slideContent, texts, imageIds);

    const relationshipPath = `ppt/slides/_rels/slide${match[1]}.xml.rels`;
    const relationshipEntry = entryMap.get(relationshipPath);
    const relationships = relationshipEntry
      ? parseRelationships(readXml(entryMap, relationshipPath))
      : new Map<string, string>();
    const caption = texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

    for (const imageId of new Set(imageIds)) {
      const target = relationships.get(imageId);
      if (!target) continue;

      const imagePath = path.posix.normalize(path.posix.join('ppt/slides', target));
      if (!imagePath.startsWith('ppt/media/')) continue;
      const imageEntry = entryMap.get(imagePath);
      if (!imageEntry || imageEntry.header.size > MAX_IMAGE_BYTES) continue;

      const data = imageEntry.getData();
      const extension = imageFormat(data);
      if (!extension) continue;
      imageDimensions(data, extension);
      totalImageBytes += data.length;
      if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
        throw new Error('Les images du PowerPoint dépassent la taille maximale autorisée.');
      }
      if (slides.length >= MAX_SLIDES) {
        throw new Error(`Le PowerPoint ne peut pas importer plus de ${MAX_SLIDES} photos dans le fil.`);
      }
      slides.push({ data, extension, caption });
    }
  }

  if (slides.length === 0) {
    throw new Error('Aucune photo PNG ou JPEG exploitable n’a été trouvée dans le PowerPoint.');
  }
  return slides;
};

const imageDimensions = (data: Buffer, extension: ImportedSlideImage['extension']) => {
  let dimensions: { width: number; height: number };
  if (extension === 'png') {
    dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  } else {
    let offset = 2;
    let found: { width: number; height: number } | null = null;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      const segmentLength = data.readUInt16BE(offset + 2);
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      ) {
        found = { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
        break;
      }
      if (segmentLength < 2) break;
      offset += segmentLength + 2;
    }
    if (!found) throw new Error('Une image du PowerPoint ne peut pas être lue.');
    dimensions = found;
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 30000 ||
    dimensions.height > 30000 ||
    dimensions.width * dimensions.height > 100_000_000
  ) {
    throw new Error('Une image du PowerPoint a des dimensions trop grandes.');
  }
  return dimensions;
};

export type PresentationMedia = ImportedSlideImage;

export const createPresentation = async (project: {
  title: string;
  description: string;
}, media: PresentationMedia[]): Promise<Buffer> => {
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.author = 'ARTISANTS';
  presentation.subject = project.description.slice(0, 1000);
  presentation.title = project.title;
  presentation.company = 'ARTISANTS';

  for (const [index, item] of media.entries()) {
    const slide = presentation.addSlide();
    const image = `data:image/${item.extension === 'jpg' ? 'jpeg' : 'png'};base64,${item.data.toString('base64')}`;
    const dimensions = imageDimensions(item.data, item.extension);
    const box = { x: 0.55, y: 1.15, width: 6.05, height: 5.65 };
    const scale = Math.min(box.width / dimensions.width, box.height / dimensions.height);
    const imageWidth = dimensions.width * scale;
    const imageHeight = dimensions.height * scale;

    slide.background = { color: 'F5F7FA' };
    slide.addText(project.title, {
      x: 0.55,
      y: 0.35,
      w: 12.2,
      h: 0.5,
      fontFace: 'Arial',
      fontSize: 24,
      bold: true,
      color: '102D52',
      breakLine: false,
    });
    slide.addText(`Diapositive ${index + 1} / ${media.length}`, {
      x: 10.1,
      y: 0.92,
      w: 2.65,
      h: 0.25,
      align: 'right',
      fontFace: 'Arial',
      fontSize: 9,
      color: '61738A',
    });
    slide.addImage({
      data: image,
      x: box.x + (box.width - imageWidth) / 2,
      y: box.y + (box.height - imageHeight) / 2,
      w: imageWidth,
      h: imageHeight,
    });
    slide.addText(item.caption || project.description, {
      x: 7.05,
      y: 1.35,
      w: 5.7,
      h: 4.9,
      fontFace: 'Arial',
      fontSize: 16,
      color: '28394D',
      breakLine: false,
      valign: 'middle',
      margin: 0.15,
      fit: 'shrink',
    });
    slide.addText('ARTISANTS', {
      x: 0.55,
      y: 7.08,
      w: 2.5,
      h: 0.18,
      fontFace: 'Arial',
      fontSize: 8,
      bold: true,
      color: '007AFF',
    });
  }

  const result = await presentation.write({ outputType: 'nodebuffer', compression: true });
  if (result instanceof Uint8Array) return Buffer.from(result);
  if (result instanceof ArrayBuffer) return Buffer.from(result);
  if (typeof Blob !== 'undefined' && result instanceof Blob) return Buffer.from(await result.arrayBuffer());
  throw new Error('La génération du fichier PowerPoint a échoué.');
};
