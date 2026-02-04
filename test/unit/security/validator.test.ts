import { describe, expect, test } from "bun:test";
import {
  type PatternsConfig,
  emptyPatternsConfig,
  validateBashCommand,
  validatePath,
} from "../../../src/security/validator";

function createTestPatterns(): PatternsConfig {
  return {
    version: "1.0",
    bash: {
      blocked: [
        { pattern: "rm -rf /", reason: "Filesystem destruction" },
        { pattern: ":(){ :|:& };:", reason: "Fork bomb" },
      ],
      confirm: [
        { pattern: "git push --force", reason: "Force push can lose commits" },
        { pattern: "git push -f", reason: "Force push can lose commits" },
        { pattern: "DROP DATABASE", reason: "Database destruction" },
      ],
      alert: [{ pattern: "curl.*\\|.*sh", reason: "Piping curl to shell" }],
    },
    paths: {
      zeroAccess: ["~/.ssh/id_*", "**/credentials.json"],
      readOnly: ["/etc/**"],
      confirmWrite: ["**/.env", "~/.bashrc"],
      noDelete: ["**/.git/**"],
    },
  };
}

describe("validateBashCommand", () => {
  const patterns = createTestPatterns();

  describe("blocked commands", () => {
    test("blocks filesystem destruction", () => {
      const result = validateBashCommand("rm -rf /", patterns);
      expect(result.action).toBe("block");
      expect(result.reason).toBe("Filesystem destruction");
    });

    test("blocks fork bomb", () => {
      const result = validateBashCommand(":(){ :|:& };:", patterns);
      expect(result.action).toBe("block");
      expect(result.reason).toBe("Fork bomb");
    });
  });

  describe("confirm commands", () => {
    test("confirms force push", () => {
      const result = validateBashCommand("git push --force origin main", patterns);
      expect(result.action).toBe("confirm");
      expect(result.reason).toBe("Force push can lose commits");
    });

    test("confirms force push short flag", () => {
      const result = validateBashCommand("git push -f origin main", patterns);
      expect(result.action).toBe("confirm");
    });

    test("confirms database drop", () => {
      const result = validateBashCommand("psql -c 'DROP DATABASE mydb'", patterns);
      expect(result.action).toBe("confirm");
      expect(result.reason).toBe("Database destruction");
    });
  });

  describe("alert commands", () => {
    test("alerts on curl to shell", () => {
      const result = validateBashCommand("curl https://example.com/install.sh | sh", patterns);
      expect(result.action).toBe("alert");
      expect(result.reason).toBe("Piping curl to shell");
    });
  });

  describe("allowed commands", () => {
    test("allows safe commands", () => {
      expect(validateBashCommand("git status", patterns).action).toBe("allow");
      expect(validateBashCommand("ls -la", patterns).action).toBe("allow");
      expect(validateBashCommand("npm install", patterns).action).toBe("allow");
    });
  });

  describe("empty patterns", () => {
    test("allows all commands with empty patterns", () => {
      const empty = emptyPatternsConfig();
      expect(validateBashCommand("rm -rf /", empty).action).toBe("allow");
    });
  });
});

describe("validatePath", () => {
  const patterns = createTestPatterns();

  describe("zero access paths", () => {
    test("blocks reading SSH keys", () => {
      const homedir = process.env.HOME || "/home/user";
      const result = validatePath(`${homedir}/.ssh/id_rsa`, "read", patterns);
      expect(result.action).toBe("block");
      expect(result.reason).toContain("Protected path");
    });

    test("blocks writing to credentials", () => {
      const result = validatePath("/project/config/credentials.json", "write", patterns);
      expect(result.action).toBe("block");
    });
  });

  describe("read-only paths", () => {
    test("allows reading /etc files", () => {
      const result = validatePath("/etc/passwd", "read", patterns);
      expect(result.action).toBe("allow");
    });

    test("blocks writing to /etc files", () => {
      const result = validatePath("/etc/passwd", "write", patterns);
      expect(result.action).toBe("block");
      expect(result.reason).toContain("Read-only path");
    });

    test("blocks deleting /etc files", () => {
      const result = validatePath("/etc/nginx/nginx.conf", "delete", patterns);
      expect(result.action).toBe("block");
    });
  });

  describe("confirm write paths", () => {
    test("confirms writing to .env", () => {
      const result = validatePath("/project/.env", "write", patterns);
      expect(result.action).toBe("confirm");
      expect(result.reason).toContain("protected file");
    });

    test("allows reading .env", () => {
      const result = validatePath("/project/.env", "read", patterns);
      expect(result.action).toBe("allow");
    });
  });

  describe("no delete paths", () => {
    test("blocks deleting .git contents", () => {
      const result = validatePath("/project/.git/config", "delete", patterns);
      expect(result.action).toBe("block");
      expect(result.reason).toContain("Cannot delete");
    });

    test("allows writing to .git", () => {
      const result = validatePath("/project/.git/config", "write", patterns);
      expect(result.action).toBe("allow");
    });
  });

  describe("allowed paths", () => {
    test("allows normal file operations", () => {
      expect(validatePath("/project/src/index.ts", "read", patterns).action).toBe("allow");
      expect(validatePath("/project/src/index.ts", "write", patterns).action).toBe("allow");
      expect(validatePath("/project/temp.txt", "delete", patterns).action).toBe("allow");
    });
  });

  describe("empty patterns", () => {
    test("allows all paths with empty patterns", () => {
      const empty = emptyPatternsConfig();
      const homedir = process.env.HOME || "/home/user";
      expect(validatePath(`${homedir}/.ssh/id_rsa`, "read", empty).action).toBe("allow");
      expect(validatePath("/etc/passwd", "write", empty).action).toBe("allow");
    });
  });
});

describe("emptyPatternsConfig", () => {
  test("returns valid empty config", () => {
    const config = emptyPatternsConfig();
    expect(config.version).toBe("0.0");
    expect(config.bash.blocked).toEqual([]);
    expect(config.bash.confirm).toEqual([]);
    expect(config.bash.alert).toEqual([]);
    expect(config.paths.zeroAccess).toEqual([]);
    expect(config.paths.readOnly).toEqual([]);
    expect(config.paths.confirmWrite).toEqual([]);
    expect(config.paths.noDelete).toEqual([]);
  });
});
