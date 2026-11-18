import os
import ipaddress
import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_certs_for_dir(target_dir, system_ip="192.9.56.129"):
    certs_dir = os.path.join(target_dir, "certs")
    os.makedirs(certs_dir, exist_ok=True)
    key_path = os.path.join(certs_dir, "server.key")
    cert_path = os.path.join(certs_dir, "server.crt")

    # Generate 2048-bit RSA key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    
    # Write private key
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "AYAL HPC"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "HPC Infrastructure"),
        x509.NameAttribute(NameOID.COMMON_NAME, system_ip),
    ])

    san_list = [
        x509.IPAddress(ipaddress.IPv4Address(system_ip)),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        x509.DNSName("localhost"),
        x509.DNSName("ayal-master"),
        x509.DNSName("ayalhpc.local"),
        x509.DNSName("mas.ayal.hpc.com"),
    ]

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"Generated SSL cert and key in: {certs_dir}")
    print(f"  Key:  {key_path}")
    print(f"  Cert: {cert_path}")

if __name__ == "__main__":
    roots = [
        r"D:\HPC Web application\layahpc",
        r"D:\HPC Web application\ajicorehpc"
    ]
    for r in roots:
        generate_certs_for_dir(r)
