//@ts-check
const tsutils = require("tsutils");
const ts = require("typescript");

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.Symbol} symbol
 * @param {ts.Node} location
 */
const isFunctionType = (checker, symbol, location) => {
    const symbolType = checker.getTypeOfSymbolAtLocation(symbol, location);
    for (const t of tsutils.unionTypeParts(symbolType)) {
        if (t.getCallSignatures().length !== 0) {
            return true;
        }
    }
    return false;
};

const promiseLikeTypeFlag =
    ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Object;

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.Node} node
 */
const isPromiseLike = (checker, node) => {
    const nodeType = checker.getTypeAtLocation(node);
    for (const t of tsutils.unionTypeParts(checker.getApparentType(nodeType))) {
        if (t.flags & promiseLikeTypeFlag) return true;

        // then プロパティがあるか
        const then = t.getProperty("then");
        if (then === undefined) {
            continue;
        }

        const thenType = checker.getTypeOfSymbolAtLocation(then, node);
        for (const t of tsutils.unionTypeParts(thenType)) {
            if (
                t.getCallSignatures().some(
                    (sign) =>
                        // 引数が2つの関数を受け取るか
                        2 <= sign.parameters.length &&
                        isFunctionType(checker, sign.parameters[0], node) &&
                        isFunctionType(checker, sign.parameters[1], node)
                )
            ) {
                return true;
            }
        }
    }
    return false;
};

/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} position
 */
const getPosition = (sourceFile, position) => {
    const { line, character } =
        sourceFile.getLineAndCharacterOfPosition(position);
    return {
        line: line + 1,
        column: character,
    };
};
/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} start
 * @param {number} end
 */
const getLocation = (sourceFile, start, end) => {
    return {
        start: getPosition(sourceFile, start),
        end: getPosition(sourceFile, end),
    };
};

/**
 * @typedef {"remove_unneeded_await"} MessageIds
 */

/** @type {import("@typescript-eslint/experimental-utils").TSESLint.RuleModule<MessageIds>} */
const rule = {
    meta: {
        docs: {
            description: "Detect unneeded 'await'.",
            recommended: "warn",
            suggestion: true,
            requiresTypeChecking: true,
        },
        fixable: "code",
        hasSuggestions: true,
        messages: {
            remove_unneeded_await: "Remove unneeded 'await'.",
        },
        schema: null,
        type: "suggestion",
    },
    create(context) {
        const parserServices = context.parserServices;
        const checker = parserServices.program.getTypeChecker();

        return {
            AwaitExpression(node) {
                const awaitExpression =
                    parserServices.esTreeNodeToTSNodeMap.get(node);
                const argument = awaitExpression.expression;

                if (!isPromiseLike(checker, argument)) {
                    const start = awaitExpression.getStart();
                    const end = argument.getFullStart();

                    context.report({
                        loc: getLocation(
                            awaitExpression.getSourceFile(),
                            start,
                            end
                        ),
                        messageId: "remove_unneeded_await",
                        fix(fixer) {
                            return fixer.removeRange([start, end]);
                        },
                    });
                }
            },
        };
    },
};
module.exports = rule;
