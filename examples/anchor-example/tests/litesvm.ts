// import { assert} from "chai";
import { AnchorProvider, Program, Wallet, web3, BN } from "@coral-xyz/anchor";
import { LiteSVM } from "../local-litesvm";
import { assert } from "chai";

import IDL from "../target/idl/shipment_managment.json";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { ShipmentManagment } from "../target/types/shipment_managment";

describe("shipment-managment, litesvm tests", () => {
  let svm: LiteSVM;
  let payer: Keypair;
  let programId: PublicKey;
  let program: Program<ShipmentManagment>;

  before(async () => {
    svm = new LiteSVM();
    payer = new Keypair();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
    // @ts-ignore
    const provider = new AnchorProvider(svm as any, new Wallet(payer), {
      commitment: "confirmed",
    });
    program = new Program(IDL, provider);
    programId = program.programId;

    svm.addProgramFromFile(programId, "target/deploy/shipment_managment.so");
  })

  it("Initializes the counter", async () => {
    // Derive the counter PDA
    const initial_count = new BN(10);
    const counter_seed = "counter";

    const [counterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(counter_seed)],
      program.programId
    );

    const initInstruction = await program.methods
      .initializeCounter(initial_count)
      .accounts({
        // @ts-ignore
        counter: counterPda,
        authority: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    const blockhash = svm.latestBlockhash();
    const tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(initInstruction);
    tx.sign(payer);

    const result = svm.sendTransaction(tx);

    const rawCounterAccount = svm.getAccount(counterPda);
    assert.isNotNull(rawCounterAccount);
    assert.isTrue(rawCounterAccount.owner.equals(programId));
    assert.isTrue(rawCounterAccount.lamports > 0);

    const buf = Buffer.from(rawCounterAccount.data)

    const count = buf.readBigUInt64LE(8);
    assert.equal(count, BigInt(initial_count.toString()));
  });

it("Should successfully create a shipment", async () => {
  // Derive the counter PDA

  const [counterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter")],
    program.programId
  );

  const counterAccount = svm.getAccount(counterPda);
  const buf = Buffer.from(counterAccount.data)
  const count = buf.readBigUInt64LE(8);

  const countBytes = new BN(count).toArrayLike(Buffer, "le", 8);

  const [shipmentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("shipment"), countBytes],
    program.programId
  );

    const createShipmentIx = await program.methods
      .createShipment()
      .accounts({
        // @ts-ignore
        counter: counterPda,
        shipment: shipmentPda,
        creator: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .instruction();

    const blockhash = svm.latestBlockhash();
    const tx = new web3.Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(createShipmentIx);
    tx.sign(payer);
    const result = svm.sendTransaction(tx);

    const rawShipmentAccount = svm.getAccount(shipmentPda);

    assert.isNotNull(rawShipmentAccount);
    assert.isTrue(rawShipmentAccount.owner.equals(programId));
    assert.isTrue(rawShipmentAccount.lamports > 0);
  });
});
