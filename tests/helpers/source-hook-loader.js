const path = require("node:path");

const missingModuleCodes = new Set(["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]);
const projectRoot = path.join(__dirname, "..", "..");

const resolveCandidatePath = (candidatePath) => {
  const normalizedCandidate = candidatePath.replace(/^\.\.\//, "");
  return path.join(projectRoot, normalizedCandidate);
};

const isExpectedMissingCandidate = (error, candidatePath) => {
  if (!missingModuleCodes.has(error && error.code)) {
    return false;
  }

  const message = String(error && error.message ? error.message : "");
  const normalizedCandidate = candidatePath.replace(/^\.\.\//, "");
  const absoluteCandidate = resolveCandidatePath(candidatePath);
  return (
    message.includes(candidatePath) ||
    message.includes(normalizedCandidate) ||
    message.includes(absoluteCandidate)
  );
};

const loadFirstAvailable = (candidatePaths) => {
  const errors = [];

  for (const candidatePath of candidatePaths) {
    try {
      return {
        id: candidatePath,
        module: require(resolveCandidatePath(candidatePath))
      };
    } catch (error) {
      const message = String(error && error.message ? error.message : "");

      if (!isExpectedMissingCandidate(error, candidatePath)) {
        throw error;
      }

      errors.push(`${candidatePath}: ${message.split("\n")[0]}`);
    }
  }

  return {
    id: null,
    module: null,
    errors
  };
};

const pickFunction = (sourceModule, names) => {
  if (!sourceModule) {
    return null;
  }

  for (const name of names) {
    if (typeof sourceModule[name] === "function") {
      return sourceModule[name];
    }
  }

  if (sourceModule.default) {
    for (const name of names) {
      if (typeof sourceModule.default[name] === "function") {
        return sourceModule.default[name];
      }
    }
  }

  return null;
};

module.exports = {
  loadFirstAvailable,
  pickFunction
};
