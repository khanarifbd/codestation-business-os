type QRCodeOptions = {
  msg: string;
  dim?: number;
  pad?: number;
  mtx?: number;
  ecl?: "L" | "M" | "Q" | "H";
  ecb?: number;
  pal?: string[];
  vrb?: number;
};

declare function QRCode(options: string | QRCodeOptions): SVGSVGElement;

export default QRCode;
