import type { DataField, DataModel, TypeDef } from '@zenstackhq/language/ast';
import {
    getDefaultValue,
    getFieldAttributes,
    getFieldTypeName,
    getRelativeSourcePath,
    isFieldRequired,
    stripCommentPrefix,
} from '../extractors';
import type { TypePageProps } from '../types';
import { breadcrumbs, declarationBlock, generatedHeader, navigationFooter, referencesSection, renderDescription, sectionHeading } from './common';

function renderHeader(props: TypePageProps): string[] {
    return [
        ...generatedHeader(props.options.genCtx),
        breadcrumbs('Types', props.typeDef.name, '../'),
        '',
        `# ${props.typeDef.name} <kbd>Type</kbd>`,
        '',
    ];
}

function renderSourceAndDeclaration(props: TypePageProps): string[] {
    const sourcePath = getRelativeSourcePath(props.typeDef, props.options.schemaDir);
    const lines: string[] = [];
    if (sourcePath) {
        lines.push(`**Defined in:** \`${sourcePath}\``, '');
    }
    lines.push(...declarationBlock(props.typeDef.$cstNode?.text, sourcePath));
    return lines;
}

function orderFields(fields: DataField[], order: 'declaration' | 'alphabetical'): DataField[] {
    return order === 'alphabetical'
        ? [...fields].sort((a, b) => a.name.localeCompare(b.name))
        : [...fields];
}

function renderFieldsSection(fields: DataField[]): string[] {
    if (fields.length === 0) return [];
    const lines = [
        ...sectionHeading('Fields'), '',
        '| Field | Type | Required | Default | Attributes | Description |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const field of fields) {
        const fieldDescription = stripCommentPrefix(field.comments) || '—';
        const fieldAnchor = `<a id="field-${field.name}"></a>`;
        lines.push(
            `| ${fieldAnchor}\`${field.name}\` | ${getFieldTypeName(field, false)} | ${isFieldRequired(field) ? 'Yes' : 'No'} | ${getDefaultValue(field)} | ${getFieldAttributes(field)} | ${fieldDescription} |`,
        );
    }
    lines.push('');
    return lines;
}

function collectUsedByModels(typeDef: TypeDef, allModels: DataModel[]): DataModel[] {
    return allModels
        .filter((m) => m.mixins.some((ref) => ref.ref?.name === typeDef.name))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function renderUsedBySection(typeDef: TypeDef, usedBy: DataModel[]): string[] {
    if (usedBy.length === 0) return [];
    const firstField = typeDef.fields[0]?.name;
    const lines = [...sectionHeading('Used By'), ''];
    for (const m of usedBy) {
        const dir = m.isView ? 'views' : 'models';
        const anchor = firstField ? `#field-${firstField}` : '';
        const fieldLinks = typeDef.fields
            .map((f) => `[\`${f.name}\`](../${dir}/${m.name}.md#field-${f.name})`)
            .join(', ');
        lines.push(`- [${m.name}](../${dir}/${m.name}.md${anchor}) — ${fieldLinks}`);
    }
    lines.push('');
    return lines;
}

function renderClassDiagram(typeDef: TypeDef, usedBy: DataModel[]): string[] {
    if (usedBy.length === 0) return [];
    const lines = ['```mermaid', 'classDiagram', `    class ${typeDef.name} {`, `        <<mixin>>`];
    for (const field of typeDef.fields) {
        const typeName = field.type.reference?.ref?.name ?? field.type.type ?? 'Unknown';
        lines.push(`        ${typeName} ${field.name}`);
    }
    lines.push('    }');
    for (const m of usedBy) {
        lines.push(`    ${m.name} ..|> ${typeDef.name} : uses`);
    }
    lines.push('```', '');
    return lines;
}

/** Renders a full documentation page for a type definition, including fields, mixin usage, and a class diagram. */
export function renderTypePage(props: TypePageProps): string {
    const sortedFields = orderFields(props.typeDef.fields, props.options.fieldOrder);
    const usedBy = collectUsedByModels(props.typeDef, props.allModels);

    return [
        ...renderHeader(props),
        ...renderDescription(props.typeDef.comments, stripCommentPrefix),
        ...renderSourceAndDeclaration(props),
        ...renderFieldsSection(sortedFields),
        ...renderUsedBySection(props.typeDef, usedBy),
        ...renderClassDiagram(props.typeDef, usedBy),
        ...referencesSection('type'),
        ...navigationFooter(props.navigation),
    ].join('\n');
}
